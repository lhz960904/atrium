import { expect, test } from 'bun:test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { Db } from '../../../db';
import type { RunContext } from '../../middleware';
import type { Sandbox } from '../../sandbox/types';
import { runTool } from '../testing';
import { taskTool } from './task';

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const textModel = (text: string) => {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
};

const deps = (run: RunContext) => ({ maxContextTokens: () => 200_000, subagents: [], run });

function ctx(model: RunContext['model'], db: Db): RunContext {
  return {
    threadId: 't1',
    db,
    sandbox: {} as Sandbox,
    workspaceRoot: '/ws',
    request: { system: 's', messages: [], tools: {} as RunContext['request']['tools'] },
    model,
    emit: () => {},
    scratch: new Map(),
  };
}

const noRowsDb = {
  select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) }),
} as unknown as Db;

test('fails for an unknown subagent', async () => {
  const t = taskTool(deps(ctx(textModel('x'), noRowsDb)));
  expect(runTool(t, { description: 'd', prompt: 'p', subagent: 'nope' })).rejects.toThrow(
    "unknown subagent 'nope'",
  );
});

test('delegates to general-purpose by default and returns the subagent final text', async () => {
  const t = taskTool(deps(ctx(textModel('SUBAGENT ANSWER'), {} as Db)));
  expect(await runTool(t, { description: 'd', prompt: 'do it' })).toBe('SUBAGENT ANSWER');
});
