import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { globTool } from './glob';

let root = '';
const sandbox = {} as Sandbox; // glob reads the fs directly via workspaceRoot
const ctx = (): ToolCtx => ({ sandbox, workspaceRoot: root, db: {} as Db });
// biome-ignore lint/suspicious/noExplicitAny: execute's option arg is irrelevant here
const opts = {} as any;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrium-glob-'));
  await writeFile(join(root, 'a.ts'), '');
  await writeFile(join(root, 'b.json'), '');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('lists matching files', async () => {
  const out = await globTool(ctx()).execute?.({ description: 'd', pattern: '**/*.ts' }, opts);
  expect(out).toBe('1 files:\na.ts');
});

test('reports no matches', async () => {
  const out = await globTool(ctx()).execute?.({ description: 'd', pattern: '**/*.py' }, opts);
  expect(out).toBe('No files matched.');
});
