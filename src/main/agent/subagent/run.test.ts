import { expect, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { Db } from '@main/db';
import type { RunContext, SideCall } from '../runtime/run-context';
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

/** A db that does nothing but accept the ledger's insert. */
const inertDb = () => ({ insert: () => ({ values: () => ({ run: () => {} }) }) }) as unknown as Db;

function parentCtx(over: Partial<RunContext> = {}): RunContext {
  return {
    threadId: 't1',
    db: inertDb(),
    sandbox: {} as Sandbox,
    workspaceRoot: '/ws',
    system: 'PARENT SYSTEM PROMPT',
    notice: () => {},
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
  // parent's.
  const first = JSON.stringify(seen[0]);
  expect(first).toContain('SUBAGENT SYSTEM PROMPT');
  expect(first).toContain('do the task');
  expect(first).not.toContain('PARENT SYSTEM PROMPT');
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
    parent: parentCtx({ notice: (_name, data) => emitted.push(data) }),
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

  const phases = emitted.map((d) => (d as { phase: string }).phase);
  expect(phases[0]).toBe('start');
  expect(phases.at(-1)).toBe('done');
  const step = (emitted as { phase: string; tools?: { name: string }[] }[]).find(
    (d) => d.phase === 'step',
  );
  expect(step?.tools?.map((t) => t.name)).toEqual(['echo']);
});

test("a subagent's spend is recorded under the model that actually ran it", async () => {
  const spent: SideCall[] = [];

  await runSubagent({
    parent: parentCtx({
      spend: (call) => spent.push(call),
      providerId: 'anthropic',
      modelId: 'claude-x',
    }),
    engine: engineWith(scripted([reply([{ type: 'text', text: 'ANSWER' }], 'stop')])),
    tools: [],
    agent: def,
    prompt: 'do the task',
    subagentId: 's1',
  });

  // A subagent's calls never reach the parent turn's usage, so this record is
  // the only place they are counted at all.
  expect(spent).toHaveLength(1);
  expect(spent[0]).toMatchObject({
    kind: 'subagent',
    usage: { totalTokens: 2 },
    providerId: 'anthropic',
    modelId: 'claude-x',
  });
});
