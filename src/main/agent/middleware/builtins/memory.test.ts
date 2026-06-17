import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import type { MemoryScope } from '../../memory/paths';
import { readState } from '../../memory/state';
import { writeMemory } from '../../memory/store';
import type { RunContext, RunResultInfo } from '../types';
import { memoryMiddleware } from './memory';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-mw-'));
  created.push(d);
  return d;
}
const userMsg = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
});
const textOf = (m: UIMessage, i: number) => (m.parts[i] as { text: string }).text;
function ctxWith(messages: UIMessage[]): RunContext {
  return {
    threadId: 'thread-1',
    workspaceRoot: '/ws',
    request: { messages, system: '', tools: {} },
  } as unknown as RunContext;
}

test('beforeRun injects a <memory> block per non-empty scope, global above project', async () => {
  const globalDir = await tmp();
  const projectDir = await tmp();
  await writeMemory(globalDir, {
    name: 'Tabs',
    description: 'prefers tabs',
    type: 'preference',
    body: 'x',
  });
  await writeMemory(projectDir, {
    name: 'Build',
    description: 'use bun',
    type: 'project',
    body: 'x',
  });
  const resolveDir = (s: MemoryScope) => (s === 'global' ? globalDir : projectDir);

  const ctx = ctxWith([userMsg('hi')]);
  await memoryMiddleware({ resolveDir }).beforeRun?.(ctx);

  const parts = ctx.request.messages[0].parts;
  expect(parts).toHaveLength(3);
  expect(textOf(ctx.request.messages[0], 0)).toContain('<memory scope="global">');
  expect(textOf(ctx.request.messages[0], 0)).toContain('prefers tabs');
  expect(textOf(ctx.request.messages[0], 1)).toContain('<memory scope="project">');
  expect(textOf(ctx.request.messages[0], 2)).toBe('hi');
});

test('beforeRun skips a scope with no memories', async () => {
  const empty = await tmp();
  const resolveDir = () => empty;
  const original = [userMsg('hi')];
  const ctx = ctxWith(original);
  await memoryMiddleware({ resolveDir }).beforeRun?.(ctx);
  expect(ctx.request.messages).toBe(original);
});

test('afterRun records the thread id once per scope, deduped', async () => {
  const globalDir = await tmp();
  const projectDir = await tmp();
  await writeMemory(globalDir, { name: 'X', description: 'x', type: 'preference', body: 'x' });
  await writeMemory(projectDir, { name: 'Y', description: 'y', type: 'project', body: 'y' });
  const resolveDir = (s: MemoryScope) => (s === 'global' ? globalDir : projectDir);

  const ctx = ctxWith([userMsg('hi')]);
  const mw = memoryMiddleware({ resolveDir });
  const result = { message: userMsg('done') } as RunResultInfo;
  await mw.afterRun?.(ctx, result);
  await mw.afterRun?.(ctx, result);

  expect((await readState(globalDir)).touchedSessions).toEqual(['thread-1']);
  expect((await readState(projectDir)).touchedSessions).toEqual(['thread-1']);
});
