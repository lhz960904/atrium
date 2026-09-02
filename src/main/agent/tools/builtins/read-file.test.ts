import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { readFileTool } from './read-file';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    readFileBytes: async () => new Uint8Array(),
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', run: fakeRun() };
}

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
  expect(await runTool(t, { description: 'x', path: 'a.ts' })).toBe('file body');
  expect(gotPath).toBe('/ws/a.ts'); // relative input normalized to absolute under the root
});

test('reports an empty file as (empty)', async () => {
  const t = readFileTool(ctx({ readFile: async () => '' }));
  expect(await runTool(t, { description: 'x', path: 'a.ts' })).toBe('(empty)');
});

test('slices to a 1-indexed inclusive line range', async () => {
  const t = readFileTool(ctx({ readFile: async () => 'l1\nl2\nl3\nl4' }));
  const out = await runTool(t, { description: 'x', path: 'a.ts', start_line: 2, end_line: 3 });
  expect(out).toBe('l2\nl3');
});

test('head-truncates oversized content with a hint', async () => {
  const big = 'x'.repeat(60_000);
  const t = readFileTool(ctx({ readFile: async () => big }));
  const out = (await runTool(t, { description: 'x', path: 'a.ts' })) as string;
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
  expect(runTool(notFound, { description: 'x', path: 'nope.ts' })).rejects.toThrow(
    'File not found: nope.ts',
  );
  const isDir = readFileTool(
    ctx({
      readFile: async () => {
        throw errno('EISDIR');
      },
    }),
  );
  expect(runTool(isDir, { description: 'x', path: 'src' })).rejects.toThrow(
    'Path is a directory, not a file: src',
  );
});

test('reads a path outside the workspace (reads are unrestricted)', async () => {
  let gotPath = '';
  const t = readFileTool(
    ctx({
      readFile: async (p) => {
        gotPath = p;
        return 'outside body';
      },
    }),
  );
  const out = await runTool(t, { description: 'x', path: '../x' });
  expect(out).toBe('outside body');
  expect(gotPath).toBe('/x'); // resolved to absolute, no boundary rejection
});
