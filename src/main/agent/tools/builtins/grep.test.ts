import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { grepTool } from './grep';

let root = '';
const sandbox = {} as Sandbox; // grep reads the fs directly via workspaceRoot, not the sandbox
const ctx = (): ToolCtx => ({ sandbox, workspaceRoot: root, db: {} as Db });
// biome-ignore lint/suspicious/noExplicitAny: execute's option arg is irrelevant here
const opts = {} as any;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrium-grep-'));
  await writeFile(join(root, 'a.ts'), 'const foo = 1;\n');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('formats matches as file:line: text', async () => {
  const out = await grepTool(ctx()).execute?.({ description: 'd', pattern: 'foo' }, opts);
  expect(out).toBe('1 matches:\na.ts:1: const foo = 1;');
});

test('reports no matches', async () => {
  const out = await grepTool(ctx()).execute?.({ description: 'd', pattern: 'zzz' }, opts);
  expect(out).toBe('No matches.');
});

test('returns a readable error for an invalid regex', async () => {
  const out = await grepTool(ctx()).execute?.({ description: 'd', pattern: '(' }, opts);
  expect(out).toContain('Error:');
});
