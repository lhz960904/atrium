import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { editFileTool } from './edit-file';

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

test('replaces a unique occurrence and writes back under the workspace', async () => {
  let wrotePath = '';
  let wrote = '';
  const t = editFileTool(
    ctx({
      readFile: async () => 'const a = 1;\nconst b = 2;\n',
      writeFile: async (p, content) => {
        wrotePath = p;
        wrote = content;
        return { bytes: content.length };
      },
    }),
  );
  const out = await runTool(t, {
    description: 'x',
    path: 'a.ts',
    old_string: 'const b = 2;',
    new_string: 'const b = 3;',
  });
  expect(out).toBe('Edited a.ts.');
  expect(wrotePath).toBe('/ws/a.ts'); // relative input normalized to absolute under the root
  expect(wrote).toBe('const a = 1;\nconst b = 3;\n');
});

test('fails when old_string is not found', async () => {
  const t = editFileTool(ctx({ readFile: async () => 'hello world' }));
  expect(
    runTool(t, { description: 'x', path: 'a.ts', old_string: 'missing', new_string: 'x' }),
  ).rejects.toThrow('not found in a.ts');
});

test('fails on an ambiguous match unless replace_all', async () => {
  let wrote = false;
  const t = editFileTool(
    ctx({
      readFile: async () => 'x\nx\nx',
      writeFile: async () => {
        wrote = true;
        return { bytes: 0 };
      },
    }),
  );
  await expect(
    runTool(t, { description: 'd', path: 'a.ts', old_string: 'x', new_string: 'y' }),
  ).rejects.toThrow('appears 3 times');
  expect(wrote).toBe(false); // refuses to guess which one
});

test('replace_all rewrites every occurrence', async () => {
  let wrote = '';
  const t = editFileTool(
    ctx({
      readFile: async () => 'x\nx\nx',
      writeFile: async (_p, content) => {
        wrote = content;
        return { bytes: content.length };
      },
    }),
  );
  const out = await runTool(t, {
    description: 'd',
    path: 'a.ts',
    old_string: 'x',
    new_string: 'y',
    replace_all: true,
  });
  expect(out).toBe('Replaced 3 occurrences in a.ts.');
  expect(wrote).toBe('y\ny\ny');
});

test('treats old_string literally and does not interpret $ in new_string', async () => {
  let wrote = '';
  const t = editFileTool(
    ctx({
      readFile: async () => 'price = a.b()',
      writeFile: async (_p, content) => {
        wrote = content;
        return { bytes: content.length };
      },
    }),
  );
  // old_string has regex metachars (. () ), new_string has a $& that String.replace would expand
  await runTool(t, { description: 'd', path: 'a.ts', old_string: 'a.b()', new_string: '$&cost' });
  expect(wrote).toBe('price = $&cost');
});

test('rejects a no-op edit', async () => {
  const t = editFileTool(ctx({ readFile: async () => 'same' }));
  expect(
    runTool(t, { description: 'd', path: 'a.ts', old_string: 'same', new_string: 'same' }),
  ).rejects.toThrow('identical');
});

test('rejects an empty old_string and points to write_file', async () => {
  const t = editFileTool(ctx({}));
  expect(
    runTool(t, { description: 'd', path: 'a.ts', old_string: '', new_string: 'x' }),
  ).rejects.toThrow('write_file');
});

test('maps fs error codes to friendly messages', async () => {
  const t = editFileTool(
    ctx({
      readFile: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(
    runTool(t, { description: 'd', path: 'nope.ts', old_string: 'a', new_string: 'b' }),
  ).rejects.toThrow('File not found: nope.ts');
});

test('edits a path outside the workspace (the boundary is the approval gate, not this tool)', async () => {
  let wrotePath = '';
  const t = editFileTool(
    ctx({
      readFile: async () => 'a',
      writeFile: async (p, content) => {
        wrotePath = p;
        return { bytes: content.length };
      },
    }),
  );
  const out = await runTool(t, {
    description: 'd',
    path: '../x',
    old_string: 'a',
    new_string: 'b',
  });
  expect(out).toBe('Edited ../x.');
  expect(wrotePath).toBe('/x');
});
