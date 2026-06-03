import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { readFileTool } from './read-file';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', db: {} as Db };
}

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant to these tests
const opts = {} as any;
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

test('resolves the path under the workspace and returns the contents', async () => {
  let gotPath = '';
  const t = readFileTool(
    ctx({
      readFile: async (p) => {
        gotPath = p;
        return 'file body';
      },
    }),
  );
  expect(await t.execute?.({ description: 'x', path: 'a.ts' }, opts)).toBe('file body');
  expect(gotPath).toBe('/ws/a.ts'); // relative input normalized to absolute under the root
});

test('reports an empty file as (empty)', async () => {
  const t = readFileTool(ctx({ readFile: async () => '' }));
  expect(await t.execute?.({ description: 'x', path: 'a.ts' }, opts)).toBe('(empty)');
});

test('slices to a 1-indexed inclusive line range', async () => {
  const t = readFileTool(ctx({ readFile: async () => 'l1\nl2\nl3\nl4' }));
  const out = await t.execute?.(
    { description: 'x', path: 'a.ts', start_line: 2, end_line: 3 },
    opts,
  );
  expect(out).toBe('l2\nl3');
});

test('head-truncates oversized content with a hint', async () => {
  const big = 'x'.repeat(60_000);
  const t = readFileTool(ctx({ readFile: async () => big }));
  const out = (await t.execute?.({ description: 'x', path: 'a.ts' }, opts)) as string;
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain('truncated: showing first 50000 of 60000');
  expect(out).toContain('start_line/end_line');
});

test('maps fs error codes to friendly messages', async () => {
  const notFound = readFileTool(
    ctx({
      readFile: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(await notFound.execute?.({ description: 'x', path: 'nope.ts' }, opts)).toBe(
    'Error: File not found: nope.ts',
  );
  const isDir = readFileTool(
    ctx({
      readFile: async () => {
        throw errno('EISDIR');
      },
    }),
  );
  expect(await isDir.execute?.({ description: 'x', path: 'src' }, opts)).toBe(
    'Error: Path is a directory, not a file: src',
  );
});

test('rejects a path that escapes the workspace (tool-level guard)', async () => {
  let read = false;
  const t = readFileTool(
    ctx({
      readFile: async () => {
        read = true;
        return 'should not happen';
      },
    }),
  );
  const out = await t.execute?.({ description: 'x', path: '../x' }, opts);
  expect(out).toContain('escapes the workspace');
  expect(read).toBe(false); // guarded before touching the sandbox
});
