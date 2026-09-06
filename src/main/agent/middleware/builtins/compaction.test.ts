import { expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { LanguageModel, ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { RunContext } from '../types';
import { type CompactionOptions, compactionMiddleware } from './compaction';

function summaryModel(capture?: (o: LanguageModelV3CallOptions) => void): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (opts) => {
      capture?.(opts);
      return {
        content: [{ type: 'text', text: 'SUMMARY' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

function makeCtx(model: LanguageModel): RunContext {
  return {
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/tmp',
    request: { system: '', messages: [], tools: {} as RunContext['request']['tools'] },
    model,
    emit: () => {},
    scratch: new Map(),
  };
}

// ── within-turn (beforeStep) ──────────────────────────────────────────────

const toolCall = (id: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: 'read', input: {} }],
});
const toolResult = (id: string, value: string): ModelMessage => ({
  role: 'tool',
  content: [
    { type: 'tool-result', toolCallId: id, toolName: 'read', output: { type: 'text', value } },
  ],
});

function stepWith(messages: ModelMessage[], opts: Partial<CompactionOptions> = {}) {
  const ctx = makeCtx(opts.summaryModel ?? summaryModel());
  const mw = compactionMiddleware({
    maxContextTokens: () => 100,
    keepRecentTokens: 10,
    minKeepMessages: 2,
    ...opts,
  });
  return { ctx, run: () => mw.beforeStep?.(ctx, { stepNumber: 0, messages }) };
}

test('beforeStep returns no override when the loop is under threshold', async () => {
  const { run } = stepWith([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'ok' },
  ]);
  expect(await run()).toBeUndefined();
});

test('beforeStep folds a ballooning loop into one user summary, no ack', async () => {
  const big = 'x'.repeat(240); // ~60 tokens each, two of them clears the 80 threshold
  const messages: ModelMessage[] = [
    { role: 'user', content: 'start' },
    toolCall('1'),
    toolResult('1', big),
    toolCall('2'),
    toolResult('2', big),
    toolCall('3'),
  ];
  const { ctx, run } = stepWith(messages);
  const out = (await run()) as { messages: ModelMessage[] };

  expect(out.messages[0].role).toBe('user');
  expect(out.messages[0].content).toContain('SUMMARY');
  // recent tail starts on an assistant tool-call — no ack inserted
  expect(out.messages[1].role).toBe('assistant');
  expect(ctx.scratch.get('compaction:turn')).toMatchObject({ coveredCount: 3 });
});

test('beforeStep deterministically reuses the scratch checkpoint under threshold', async () => {
  const { ctx, run } = stepWith(
    [{ role: 'user', content: 'start' }, toolCall('1'), toolResult('1', 'small'), toolCall('2')],
    { maxContextTokens: () => 1000 },
  );
  ctx.scratch.set('compaction:turn', {
    summary: [{ role: 'user', content: 'PRIOR' }],
    coveredCount: 2,
  });
  const out = (await run()) as { messages: ModelMessage[] };
  // [summary, ...messages.slice(2)] — prefix is the cached summary, tail follows
  expect(out.messages[0].content).toBe('PRIOR');
  expect(out.messages).toHaveLength(3);
});
