import { expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { LanguageModel, ModelMessage, UIMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { RunContext } from '../types';
import { applyCheckpoint, type CompactionOptions, compactionMiddleware } from './compaction';

const msg = (
  id: string,
  role: UIMessage['role'],
  text: string,
  metadata?: Record<string, unknown>,
): UIMessage => ({ id, role, parts: [{ type: 'text', text }], metadata }) as UIMessage;

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

function makeCtx(messages: UIMessage[], model: LanguageModel): RunContext {
  return {
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/tmp',
    request: { system: '', messages, tools: {} as RunContext['request']['tools'] },
    model,
    emit: () => {},
    scratch: new Map(),
  };
}

function runWith(messages: UIMessage[], opts: Partial<CompactionOptions> = {}) {
  const persisted: UIMessage[] = [];
  const model = opts.summaryModel ?? summaryModel();
  const ctx = makeCtx(messages, model);
  const mw = compactionMiddleware({
    maxContextTokens: () => 1000,
    persist: (_db, _t, m) => persisted.push(m),
    keepRecentTokens: 1,
    minKeepMessages: 2,
    countTokens: () => 900,
    ...opts,
  });
  return { ctx, persisted, run: () => mw.beforeRun?.(ctx) };
}

test('applyCheckpoint rebuilds by id, recovering messages that sort before the checkpoint', () => {
  // createdAt order: the checkpoint pair is newest, so it sorts after a2/u3 —
  // the very messages it should precede. Reconstruction must recover them.
  const messages = [
    msg('u1', 'user', 'a'),
    msg('a1', 'assistant', 'b'),
    msg('u2', 'user', 'c'),
    msg('a2', 'assistant', 'd'),
    msg('u3', 'user', 'e'),
    msg('sum', 'user', 'summary', { kind: 'compaction', coveredThroughId: 'u2' }),
    msg('ack', 'assistant', 'ok', { kind: 'compaction-ack' }),
    msg('a3', 'assistant', 'f'),
  ];
  const out = applyCheckpoint(messages);
  expect(out.map((m) => m.id)).toEqual(['sum', 'ack', 'a2', 'u3', 'a3']);
});

test('beforeRun under threshold folds at the checkpoint but does not re-summarize', async () => {
  const { ctx, persisted, run } = runWith([msg('u1', 'user', 'hi')], { countTokens: () => 100 });
  await run();
  expect(persisted).toHaveLength(0);
  expect(ctx.request.messages.map((m) => m.id)).toEqual(['u1']);
});

test('beforeRun over threshold persists a checkpoint pair and keeps a recent tail', async () => {
  const messages = [
    msg('u1', 'user', 'a'),
    msg('a1', 'assistant', 'b'),
    msg('u2', 'user', 'c'),
    msg('a2', 'assistant', 'd'),
    msg('u3', 'user', 'e'),
    msg('a3', 'assistant', 'f'),
  ];
  const { ctx, persisted, run } = runWith(messages);
  await run();

  expect(persisted).toHaveLength(2);
  const out = ctx.request.messages;
  expect(out[0].metadata).toMatchObject({ kind: 'compaction' });
  expect((out[0].parts[0] as { text: string }).text).toContain('SUMMARY');
  expect(out[1].metadata).toMatchObject({ kind: 'compaction-ack' });
  // the kept tail is preserved verbatim at the end
  expect(out.at(-1)?.id).toBe('a3');
  // covered through the last folded message, not into the kept tail
  expect(out[0].metadata).toMatchObject({ coveredThroughId: 'a2' });
});

test('a second compaction folds the prior summary into the new one (incremental)', async () => {
  let prompt = '';
  const model = summaryModel((o) => {
    prompt = JSON.stringify(o.prompt);
  });
  const messages = [
    msg('u1', 'user', 'a'),
    msg('a1', 'assistant', 'b'),
    msg('sum1', 'user', 'PRIOR_SUMMARY', { kind: 'compaction', coveredThroughId: 'a1' }),
    msg('ack1', 'assistant', 'ok', { kind: 'compaction-ack' }),
    msg('u2', 'user', 'c'),
    msg('a2', 'assistant', 'd'),
    msg('u3', 'user', 'e'),
  ];
  const { run } = runWith(messages, { summaryModel: model });
  await run();
  expect(prompt).toContain('PRIOR_SUMMARY');
});

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
  const ctx = makeCtx([], opts.summaryModel ?? summaryModel());
  const mw = compactionMiddleware({
    maxContextTokens: () => 100,
    persist: () => {},
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
