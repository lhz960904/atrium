import { afterAll, expect, mock, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEMORY_TYPES } from '../../memory/store';
import type { ToolCtx } from '../context';
import { runTool } from '../testing';
import { dispatchMemory, memoryTool } from './memory';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mem-tool-'));
  created.push(d);
  return d;
}

test('the schema advertises the scope default and the known categories', () => {
  const params = memoryTool({ workspaceRoot: '/ws' } as ToolCtx).parameters as {
    properties: Record<string, { default?: string; enum?: string[] }>;
  };
  expect(params.properties.scope.default).toBe('project');
  expect(params.properties.scope.enum).toEqual(['project', 'global']);
  expect(params.properties.type.enum).toEqual([...MEMORY_TYPES]);
});

test('an omitted scope still resolves to the project dir', async () => {
  // the schema's default is advisory: the engine validates but never fills it in
  const base = await tmp();
  mock.module('electron', () => ({ app: { getPath: () => base } }));
  const t = memoryTool({ workspaceRoot: '/ws/proj' } as ToolCtx);
  await runTool(t, { command: 'write', name: 'N', description: 'd', type: 'project', body: 'b' });
  expect(await readdir(join(base, 'memory', 'projects'))).toEqual(['^ws^proj']);
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
