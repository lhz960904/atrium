import { expect, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { Db } from '../../db';
import type { RunContext } from '../run-context';
import type { Sandbox } from '../sandbox/types';
import type { AtriumTool } from '../tools';
import type { SubagentDef } from './defs';
import { runSubagent } from './run';

const MODEL = {
  id: 'm1',
  name: 'm1',
  api: 'anthropic-messages',
  provider: 'p1',
  baseUrl: 'https://example.invalid',
  contextWindow: 200_000,
  maxTokens: 1000,
} as unknown as Model<'anthropic-messages'>;

const usage = () => ({
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
});

const reply = (content: unknown[], stopReason: string): AssistantMessage =>
  ({
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'p1',
    model: 'm1',
    usage: usage(),
    stopReason,
    timestamp: 1,
  }) as unknown as AssistantMessage;

/** Answers with each scripted message in turn, recording what it was sent. */
function scripted(messages: AssistantMessage[], seen: Context[] = []): StreamFn {
  let at = 0;
  return (_model, context) => {
    seen.push(context);
    const message = messages[Math.min(at++, messages.length - 1)];
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.end(message));
    return stream;
  };
}

const engineWith = (streamFn: StreamFn) => ({
  model: MODEL,
  streamFn,
  getApiKey: () => 'key',
});

const echoTool = {
  name: 'echo',
  label: 'echo',
  description: 'echo',
  parameters: { type: 'object' },
  execute: async () => ({
    content: [{ type: 'text', text: 'TOOL_RESULT_SHOULD_NOT_SURFACE' }],
    details: 'TOOL_RESULT_SHOULD_NOT_SURFACE',
  }),
} as unknown as AtriumTool;

function parentCtx(over: Partial<RunContext> = {}): RunContext {
  return {
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/ws',
    system: 'PARENT SYSTEM PROMPT',
    history: [{ id: 'ph', role: 'user', parts: [{ type: 'text', text: 'PARENT_HISTORY' }] }],
    emit: () => {},
    scratch: new Map(),
    ...over,
  } as RunContext;
}

const def: SubagentDef = {
  name: 'tester',
  description: 'test subagent',
  systemPrompt: 'SUBAGENT SYSTEM PROMPT',
};

test('returns the final assistant text and runs in an isolated context', async () => {
  const seen: Context[] = [];
  const result = await runSubagent({
    parent: parentCtx(),
    engine: engineWith(scripted([reply([{ type: 'text', text: 'THE ANSWER' }], 'stop')], seen)),
    tools: [],
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
  });

  expect(result.text).toBe('THE ANSWER');
  // Isolation: the child sees its own system prompt + just the task, never the
  // parent's system prompt or conversation history.
  const first = JSON.stringify(seen[0]);
  expect(first).toContain('SUBAGENT SYSTEM PROMPT');
  expect(first).toContain('do the task');
  expect(first).not.toContain('PARENT SYSTEM PROMPT');
  expect(first).not.toContain('PARENT_HISTORY');
});

test('runs the full loop but returns only the final text, never tool output', async () => {
  const seen: Context[] = [];
  const result = await runSubagent({
    parent: parentCtx(),
    engine: engineWith(
      scripted(
        [
          reply([{ type: 'toolCall', id: 'c1', name: 'echo', arguments: {} }], 'toolUse'),
          reply([{ type: 'text', text: 'FINAL SYNTHESIS' }], 'stop'),
        ],
        seen,
      ),
    ),
    tools: [echoTool],
    agent: def,
    prompt: 'use the tool then answer',
    subagentId: 's2',
  });

  expect(seen).toHaveLength(2); // the model was re-invoked after the tool ran
  expect(result.text).toBe('FINAL SYNTHESIS');
  expect(result.text).not.toContain('TOOL_RESULT_SHOULD_NOT_SURFACE');
});

test('bubbles its activity up to the parent, minus the plan tool', async () => {
  const emitted: unknown[] = [];
  await runSubagent({
    parent: parentCtx({ emit: (chunk) => emitted.push(chunk) }),
    engine: engineWith(
      scripted([
        reply(
          [
            { type: 'toolCall', id: 'c1', name: 'echo', arguments: {} },
            { type: 'toolCall', id: 'c2', name: 'todo_write', arguments: {} },
          ],
          'toolUse',
        ),
        reply([{ type: 'text', text: 'DONE' }], 'stop'),
      ]),
    ),
    tools: [echoTool],
    agent: def,
    prompt: 'go',
    subagentId: 's3',
  });

  const phases = emitted.map((c) => (c as { data: { phase: string } }).data.phase);
  expect(phases[0]).toBe('start');
  expect(phases.at(-1)).toBe('done');
  const step = emitted
    .map((c) => (c as { data: { phase: string; tools?: { name: string }[] } }).data)
    .find((d) => d.phase === 'step');
  expect(step?.tools?.map((t) => t.name)).toEqual(['echo']);
});

test('records its own usage under the inherited model (kind=subagent)', async () => {
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
    parent: parentCtx({ db: captureDb, providerId: 'anthropic', modelId: 'claude-x' }),
    engine: engineWith(scripted([reply([{ type: 'text', text: 'ANSWER' }], 'stop')])),
    tools: [],
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
    pricingOf: () => ({ input: 0.001, output: 0.002, cacheRead: 0, cacheCreation: 0 }),
  });

  expect(row?.kind).toBe('subagent');
  expect(row?.providerId).toBe('anthropic');
  expect(row?.modelId).toBe('claude-x');
  expect(row?.inputTokens).toBe(1);
  expect(row?.outputTokens).toBe(1);
  expect(row?.totalTokens).toBe(2);
  // 1 input * 0.001 + 1 output * 0.002 = 0.003 USD → 3000 micros.
  expect(row?.costUsdMicros).toBe(3000);
});

test('skips recording when no pricing is injected', async () => {
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
    parent: parentCtx({ db: captureDb, providerId: 'anthropic', modelId: 'claude-x' }),
    engine: engineWith(scripted([reply([{ type: 'text', text: 'ANSWER' }], 'stop')])),
    tools: [],
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
  });

  expect(inserted).toBe(false);
});
