import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { grepTool } from './grep';

let root = '';
const sandbox = {} as Sandbox; // grep reads the fs directly via workspaceRoot, not the sandbox
const ctx = (): ToolCtx => ({ sandbox, workspaceRoot: root, run: fakeRun() });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atrium-grep-'));
  await writeFile(join(root, 'a.ts'), 'const foo = 1;\n');
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test('formats matches as file:line: text', async () => {
  const out = await runTool(grepTool(ctx()), { description: 'd', pattern: 'foo' });
  expect(out).toBe('1 matches:\na.ts:1: const foo = 1;');
});

test('reports no matches', async () => {
  const out = await runTool(grepTool(ctx()), { description: 'd', pattern: 'zzz' });
  expect(out).toBe('No matches.');
});

test('fails with a readable message for an invalid regex', async () => {
  expect(runTool(grepTool(ctx()), { description: 'd', pattern: '(' })).rejects.toThrow();
});
