import { expect, test } from 'bun:test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { type Tool, tool } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';
import type { Db } from '../../db';
import type { RunContext } from '../middleware';
import type { Sandbox } from '../sandbox/types';
import type { SubagentDef } from './defs';
import { runSubagent } from './run';

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const textChunks = (text: string): LanguageModelV3StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE },
];

const toolCallChunks: LanguageModelV3StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', input: '{}' },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage: USAGE },
];

const echoTool = (): Tool =>
  tool({
    description: 'echo',
    inputSchema: z.object({}),
    execute: async () => 'TOOL_RESULT_SHOULD_NOT_SURFACE',
  });

function parentCtx(model: RunContext['model'], tools: Record<string, Tool> = {}): RunContext {
  return {
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/ws',
    request: {
      system: 'PARENT SYSTEM PROMPT',
      messages: [{ id: 'ph', role: 'user', parts: [{ type: 'text', text: 'PARENT_HISTORY' }] }],
      // biome-ignore lint/suspicious/noExplicitAny: parent tool map shape is irrelevant to these tests
      tools: tools as any,
    },
    model,
    emit: () => {},
    scratch: new Map(),
  };
}

const def: SubagentDef = {
  name: 'tester',
  description: 'test subagent',
  systemPrompt: 'SUBAGENT SYSTEM PROMPT',
};

test('returns the final assistant text and runs in an isolated context', async () => {
  const seen: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (opts) => {
      seen.push(opts.prompt);
      return { stream: simulateReadableStream({ chunks: textChunks('THE ANSWER') }) };
    },
  });

  const result = await runSubagent({
    parent: parentCtx(model),
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
    maxContextTokens: () => 200_000,
  });

  expect(result.text).toBe('THE ANSWER');

  // Isolation: the child sees its own system prompt + just the task, never the
  // parent's system prompt or conversation history.
  const firstCall = JSON.stringify(seen[0]);
  expect(firstCall).toContain('SUBAGENT SYSTEM PROMPT');
  expect(firstCall).toContain('do the task');
  expect(firstCall).not.toContain('PARENT SYSTEM PROMPT');
  expect(firstCall).not.toContain('PARENT_HISTORY');
});

test('runs the full loop but returns only the final text, never tool output', async () => {
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      call++;
      const chunks = call === 1 ? toolCallChunks : textChunks('FINAL SYNTHESIS');
      return { stream: simulateReadableStream({ chunks }) };
    },
  });

  const result = await runSubagent({
    parent: parentCtx(model, { echo: echoTool() }),
    agent: def,
    prompt: 'use the tool then answer',
    subagentId: 's2',
    maxContextTokens: () => 200_000,
  });

  expect(call).toBe(2); // model was re-invoked after the tool ran
  expect(result.text).toBe('FINAL SYNTHESIS');
  expect(result.text).not.toContain('TOOL_RESULT_SHOULD_NOT_SURFACE');
});

test('records its own usage under the inherited model (kind=subagent)', async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: textChunks('ANSWER') }) }),
  });
  let row: Record<string, unknown> | undefined;
  const captureDb = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        run: () => {
          row = v;
        },
      }),
    }),
  } as unknown as Db;

  await runSubagent({
    // No pinned model on `def`, so the child inherits the parent's identity.
    parent: { ...parentCtx(model), db: captureDb, providerId: 'anthropic', modelId: 'claude-x' },
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
    maxContextTokens: () => 200_000,
    pricingOf: () => ({ input: 0.001, output: 0.002, cacheRead: 0, cacheCreation: 0 }),
  });

  expect(row?.kind).toBe('subagent');
  expect(row?.providerId).toBe('anthropic');
  expect(row?.modelId).toBe('claude-x');
  expect(row?.inputTokens).toBe(1);
  expect(row?.outputTokens).toBe(1);
  expect(row?.totalTokens).toBe(2);
  // 1 noCache input * 0.001 + 1 output * 0.002 = 0.003 USD → 3000 micros.
  expect(row?.costUsdMicros).toBe(3000);
});

test('skips recording when no pricing is injected', async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: textChunks('ANSWER') }) }),
  });
  let inserted = false;
  const captureDb = {
    insert: () => ({
      values: () => ({
        run: () => {
          inserted = true;
        },
      }),
    }),
  } as unknown as Db;

  await runSubagent({
    parent: { ...parentCtx(model), db: captureDb, providerId: 'anthropic', modelId: 'claude-x' },
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
    maxContextTokens: () => 200_000,
  });

  expect(inserted).toBe(false);
});
