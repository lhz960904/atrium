import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchMemory, memoryInputSchema } from './memory';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-tool-'));
  created.push(d);
  return d;
}

test('scope defaults to project, honored when given', () => {
  expect(memoryInputSchema.parse({ command: 'view' }).scope).toBe('project');
  expect(memoryInputSchema.parse({ command: 'write', scope: 'global' }).scope).toBe('global');
});

test('type only accepts known categories', () => {
  expect(memoryInputSchema.parse({ command: 'write', type: 'preference' }).type).toBe('preference');
  expect(() => memoryInputSchema.parse({ command: 'write', type: 'misc' })).toThrow();
});

test('dispatch: write creates the file + index, view reads them back', async () => {
  const dir = await tmp();
  await dispatchMemory(dir, {
    command: 'write',
    name: 'Tabs',
    description: 'prefers tabs',
    type: 'preference',
    body: 'use tabs',
  });
  expect(await dispatchMemory(dir, { command: 'view' })).toContain('- Tabs — prefers tabs');
  expect(await dispatchMemory(dir, { command: 'view', name: 'Tabs' })).toContain('use tabs');
});

test('dispatch: write without the required fields throws', async () => {
  const dir = await tmp();
  await expect(dispatchMemory(dir, { command: 'write', name: 'X' })).rejects.toThrow('requires');
});

test('dispatch: delete removes the entry', async () => {
  const dir = await tmp();
  await dispatchMemory(dir, {
    command: 'write',
    name: 'X',
    description: 'd',
    type: 'project',
    body: 'b',
  });
  await dispatchMemory(dir, { command: 'delete', name: 'X' });
  expect(await dispatchMemory(dir, { command: 'view', name: 'X' })).toContain('no memory named');
});
