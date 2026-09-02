import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { listDirTool } from './list-dir';

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

test('joins entries with newlines and resolves the path', async () => {
  let gotPath = '';
  const t = listDirTool(
    ctx({
      list: async (p) => {
        gotPath = p;
        return ['a.ts', 'sub/', 'sub/b.ts'];
      },
    }),
  );
  const out = await runTool(t, { description: 'x', path: 'src' });
  expect(gotPath).toBe('/ws/src');
  expect(out).toBe('a.ts\nsub/\nsub/b.ts');
});

test('defaults to the workspace root when path is omitted', async () => {
  let gotPath = '';
  const t = listDirTool(
    ctx({
      list: async (p) => {
        gotPath = p;
        return ['x'];
      },
    }),
  );
  await runTool(t, { description: 'x' });
  expect(gotPath).toBe('/ws');
});

test('reports an empty directory', async () => {
  const t = listDirTool(ctx({ list: async () => [] }));
  expect(await runTool(t, { description: 'x', path: '.' })).toBe('(empty)');
});

test('maps a missing directory to a friendly failure', async () => {
  const t = listDirTool(
    ctx({
      list: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(runTool(t, { description: 'x', path: 'nope' })).rejects.toThrow(
    'Directory not found: nope',
  );
});

test('lists a path outside the workspace (reads are unrestricted)', async () => {
  let gotPath = '';
  const t = listDirTool(
    ctx({
      list: async (p) => {
        gotPath = p;
        return ['out.txt'];
      },
    }),
  );
  const out = await runTool(t, { description: 'x', path: '../x' });
  expect(out).toBe('out.txt');
  expect(gotPath).toBe('/x');
});
