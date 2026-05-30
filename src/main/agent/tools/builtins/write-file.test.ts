import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { writeFileTool } from './write-file';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    writeFile: async (_p, content) => ({ bytes: Buffer.byteLength(content, 'utf8') }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws' };
}

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant here
const opts = {} as any;
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

test('resolves the path, writes, and reports bytes', async () => {
  let gotPath = '';
  let gotAppend: boolean | undefined;
  const t = writeFileTool(
    ctx({
      writeFile: async (p, content, append) => {
        gotPath = p;
        gotAppend = append;
        return { bytes: Buffer.byteLength(content, 'utf8') };
      },
    }),
  );
  const out = await t.execute?.({ description: 'x', path: 'a.txt', content: 'hello' }, opts);
  expect(gotPath).toBe('/ws/a.txt');
  expect(gotAppend).toBe(false);
  expect(out).toContain('5 bytes');
});

test('passes the append flag through', async () => {
  let gotAppend: boolean | undefined;
  const t = writeFileTool(
    ctx({
      writeFile: async (_p, content, append) => {
        gotAppend = append;
        return { bytes: content.length };
      },
    }),
  );
  await t.execute?.({ description: 'x', path: 'a.txt', content: 'x', append: true }, opts);
  expect(gotAppend).toBe(true);
});

test('maps permission errors to a friendly message', async () => {
  const t = writeFileTool(
    ctx({
      writeFile: async () => {
        throw errno('EACCES');
      },
    }),
  );
  expect(await t.execute?.({ description: 'x', path: 'a.txt', content: 'x' }, opts)).toBe(
    'Error: Permission denied writing to file: a.txt',
  );
});

test('rejects a path that escapes the workspace before touching the sandbox', async () => {
  let wrote = false;
  const t = writeFileTool(
    ctx({
      writeFile: async () => {
        wrote = true;
        return { bytes: 0 };
      },
    }),
  );
  const out = await t.execute?.({ description: 'x', path: '../x', content: 'x' }, opts);
  expect(out).toContain('escapes the workspace');
  expect(wrote).toBe(false);
});
