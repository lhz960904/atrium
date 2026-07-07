import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { viewImageTool } from './view-image';

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

const png = (extra = 4) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(extra).fill(0)]);

test('returns structured output with a data url for a png', async () => {
  let gotPath = '';
  const t = viewImageTool(
    ctx({
      readFileBytes: async (p) => {
        gotPath = p;
        return png();
      },
    }),
  );
  const result = await t.execute?.({ description: 'x', path: 'shot.png' }, opts);
  expect(gotPath).toBe('/ws/shot.png');
  expect(result).toEqual({
    text: '/ws/shot.png (image/png, 1 KB)',
    images: [
      {
        mediaType: 'image/png',
        dataUrl: `data:image/png;base64,${Buffer.from(png()).toString('base64')}`,
        filename: 'shot.png',
      },
    ],
  });
});

test('rejects a file that is not a supported image', async () => {
  const t = viewImageTool(
    ctx({ readFileBytes: async () => new TextEncoder().encode('hello world') }),
  );
  expect(await t.execute?.({ description: 'x', path: 'notes.txt' }, opts)).toContain(
    'Not a supported image file',
  );
});

test('rejects an image over the inline limit with a downscale hint', async () => {
  const big = new Uint8Array(3 * 1024 * 1024 + 1);
  big.set([0x89, 0x50, 0x4e, 0x47]);
  const t = viewImageTool(ctx({ readFileBytes: async () => big }));
  const result = await t.execute?.({ description: 'x', path: 'huge.png' }, opts);
  expect(result).toContain('over the 3MB inline limit');
  expect(result).toContain('sips');
});

test('maps fs errors to model-readable messages', async () => {
  const t = viewImageTool(
    ctx({
      readFileBytes: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(await t.execute?.({ description: 'x', path: 'missing.png' }, opts)).toBe(
    'Error: File not found: missing.png',
  );
});
