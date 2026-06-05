import { expect, test } from 'bun:test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { Db } from '../../../db';
import type { RunContext } from '../../middleware';
import type { Sandbox } from '../../sandbox/types';
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

const deps = { maxContextTokens: () => 200_000, subagents: [] };

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

// biome-ignore lint/suspicious/noExplicitAny: tool execute's options arg only needs experimental_context here
const exec = (ec: RunContext): any => ({ experimental_context: ec });

test('returns an error for an unknown subagent', async () => {
  const result = await taskTool(deps).execute?.(
    { description: 'd', prompt: 'p', subagent: 'nope' },
    exec(ctx(textModel('x'), noRowsDb)),
  );
  expect(result).toContain("unknown subagent 'nope'");
});

test('delegates to general-purpose by default and returns the subagent final text', async () => {
  const result = await taskTool(deps).execute?.(
    { description: 'd', prompt: 'do it' },
    exec(ctx(textModel('SUBAGENT ANSWER'), {} as Db)),
  );
  expect(result).toBe('SUBAGENT ANSWER');
});
