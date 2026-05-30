import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { listDirTool } from './list-dir';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws' };
}

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant here
const opts = {} as any;
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
  const out = await t.execute?.({ description: 'x', path: 'src' }, opts);
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
  await t.execute?.({ description: 'x' }, opts);
  expect(gotPath).toBe('/ws');
});

test('reports an empty directory', async () => {
  const t = listDirTool(ctx({ list: async () => [] }));
  expect(await t.execute?.({ description: 'x', path: '.' }, opts)).toBe('(empty)');
});

test('maps a missing directory to a friendly message', async () => {
  const t = listDirTool(
    ctx({
      list: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(await t.execute?.({ description: 'x', path: 'nope' }, opts)).toBe(
    'Error: Directory not found: nope',
  );
});

test('rejects a path that escapes the workspace', async () => {
  let listed = false;
  const t = listDirTool(
    ctx({
      list: async () => {
        listed = true;
        return [];
      },
    }),
  );
  const out = await t.execute?.({ description: 'x', path: '../x' }, opts);
  expect(out).toContain('escapes the workspace');
  expect(listed).toBe(false);
});
