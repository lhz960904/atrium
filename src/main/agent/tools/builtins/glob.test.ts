import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { globTool } from './glob';

let root = '';
const sandbox = {} as Sandbox; // glob reads the fs directly via workspaceRoot
const ctx = (): ToolCtx => ({ sandbox, workspaceRoot: root, run: fakeRun() });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrium-glob-'));
  await writeFile(join(root, 'a.ts'), '');
  await writeFile(join(root, 'b.json'), '');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('lists matching files', async () => {
  const out = await runTool(globTool(ctx()), { description: 'd', pattern: '**/*.ts' });
  expect(out).toBe('1 files:\na.ts');
});

test('reports no matches', async () => {
  const out = await runTool(globTool(ctx()), { description: 'd', pattern: '**/*.py' });
  expect(out).toBe('No files matched.');
});
