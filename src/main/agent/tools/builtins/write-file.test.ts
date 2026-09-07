import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { writeFileTool } from './write-file';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    readFileBytes: async () => new Uint8Array(),
    writeFile: async (_p, content) => ({ bytes: Buffer.byteLength(content, 'utf8') }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', run: fakeRun() };
}

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
  const out = await runTool(t, { description: 'x', path: 'a.txt', content: 'hello' });
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
  await runTool(t, { description: 'x', path: 'a.txt', content: 'x', append: true });
  expect(gotAppend).toBe(true);
});

test('maps permission errors to a friendly failure', async () => {
  const t = writeFileTool(
    ctx({
      writeFile: async () => {
        throw errno('EACCES');
      },
    }),
  );
  expect(runTool(t, { description: 'x', path: 'a.txt', content: 'x' })).rejects.toThrow(
    'Permission denied writing to file: a.txt',
  );
});

test('writes outside the workspace (the boundary is the approval gate, not this tool)', async () => {
  let gotPath = '';
  const t = writeFileTool(
    ctx({
      writeFile: async (p, content) => {
        gotPath = p;
        return { bytes: Buffer.byteLength(content, 'utf8') };
      },
    }),
  );
  const out = await runTool(t, { description: 'x', path: '../x', content: 'x' });
  expect(gotPath).toBe('/x');
  expect(out).toContain('1 bytes');
});
