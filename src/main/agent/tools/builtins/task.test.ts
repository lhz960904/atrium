import { expect, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { Db } from '../../../db';
import type { RunContext } from '../../run-context';
import type { Sandbox } from '../../sandbox/types';
import { runTool } from '../testing';
import { taskTool } from './task';

const MODEL = {
  id: 'm1',
  api: 'anthropic-messages',
  provider: 'p1',
  contextWindow: 200_000,
} as unknown as Model<'anthropic-messages'>;

/** A stream function that answers with one text block and stops. */
const answering = (text: string): StreamFn => {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'p1',
    model: 'm1',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as AssistantMessage;
  return () => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.end(message));
    return stream;
  };
};

const deps = (run: RunContext, text: string) => ({
  siblings: () => [],
  subagents: [],
  run,
  engine: { model: MODEL, streamFn: answering(text), getApiKey: () => 'key' },
});

function ctx(db: Db): RunContext {
  return {
    threadId: 't1',
    db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/ws',
    system: 's',
    notice: () => {},
    scratch: new Map(),
  };
}

const noRowsDb = {
  select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) }),
} as unknown as Db;

test('fails for an unknown subagent', async () => {
  const t = taskTool(deps(ctx(noRowsDb), 'x'));
  expect(runTool(t, { description: 'd', prompt: 'p', subagent: 'nope' })).rejects.toThrow(
    "unknown subagent 'nope'",
  );
});

test('delegates to general-purpose by default and returns the subagent final text', async () => {
  const t = taskTool(deps(ctx({} as Db), 'SUBAGENT ANSWER'));
  expect(await runTool(t, { description: 'd', prompt: 'do it' })).toBe('SUBAGENT ANSWER');
});

test('refuses when the turn has no engine to nest on', async () => {
  const { engine: _dropped, ...noEngine } = deps(ctx({} as Db), 'x');
  const t = taskTool(noEngine);
  expect(runTool(t, { description: 'd', prompt: 'p' })).rejects.toThrow('unavailable');
});
