import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { editFileTool } from './edit-file';

function ctx(over: Partial<Sandbox>): ToolCtx {
  const base: Sandbox = {
    readFile: async () => '',
    readFileBytes: async () => new Uint8Array(),
    writeFile: async () => ({ bytes: 0 }),
    list: async () => [],
    exec: async () => ({ output: '', exitCode: 0 }),
  };
  return { sandbox: { ...base, ...over }, workspaceRoot: '/ws', db: {} as Db };
}

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant to these tests
const opts = {} as any;
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
  const out = await t.execute?.(
    { description: 'x', path: 'a.ts', old_string: 'const b = 2;', new_string: 'const b = 3;' },
    opts,
  );
  expect(out).toBe('Edited a.ts.');
  expect(wrotePath).toBe('/ws/a.ts'); // relative input normalized to absolute under the root
  expect(wrote).toBe('const a = 1;\nconst b = 3;\n');
});

test('errors when old_string is not found', async () => {
  const t = editFileTool(ctx({ readFile: async () => 'hello world' }));
  const out = await t.execute?.(
    { description: 'x', path: 'a.ts', old_string: 'missing', new_string: 'x' },
    opts,
  );
  expect(out).toContain('not found in a.ts');
});

test('errors on an ambiguous match unless replace_all', async () => {
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
  const out = await t.execute?.(
    { description: 'd', path: 'a.ts', old_string: 'x', new_string: 'y' },
    opts,
  );
  expect(out).toContain('appears 3 times');
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
  const out = await t.execute?.(
    { description: 'd', path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true },
    opts,
  );
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
  await t.execute?.(
    { description: 'd', path: 'a.ts', old_string: 'a.b()', new_string: '$&cost' },
    opts,
  );
  expect(wrote).toBe('price = $&cost');
});

test('rejects a no-op edit', async () => {
  const t = editFileTool(ctx({ readFile: async () => 'same' }));
  const out = await t.execute?.(
    { description: 'd', path: 'a.ts', old_string: 'same', new_string: 'same' },
    opts,
  );
  expect(out).toContain('identical');
});

test('rejects an empty old_string and points to write_file', async () => {
  const t = editFileTool(ctx({}));
  const out = await t.execute?.(
    { description: 'd', path: 'a.ts', old_string: '', new_string: 'x' },
    opts,
  );
  expect(out).toContain('write_file');
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
    await t.execute?.(
      { description: 'd', path: 'nope.ts', old_string: 'a', new_string: 'b' },
      opts,
    ),
  ).toBe('Error: File not found: nope.ts');
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
  const out = await t.execute?.(
    { description: 'd', path: '../x', old_string: 'a', new_string: 'b' },
    opts,
  );
  expect(out).toBe('Edited ../x.');
  expect(wrotePath).toBe('/x');
});
