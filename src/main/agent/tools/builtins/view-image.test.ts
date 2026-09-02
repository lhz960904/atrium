import { expect, test } from 'bun:test';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { viewImageTool } from './view-image';

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

const png = (extra = 4) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(extra).fill(0)]);

test('returns the image as details, and as content when the model can see it', async () => {
  let gotPath = '';
  const t = viewImageTool({
    ...ctx({
      readFileBytes: async (p) => {
        gotPath = p;
        return png();
      },
    }),
    supportsImageToolResults: true,
  });
  const result = await t.execute('call-1', { description: 'x', path: 'shot.png' });
  expect(gotPath).toBe('/ws/shot.png');
  const dataUrl = `data:image/png;base64,${Buffer.from(png()).toString('base64')}`;
  expect(result.details).toEqual({
    text: '/ws/shot.png (image/png, 1 KB)',
    images: [{ mediaType: 'image/png', dataUrl, filename: 'shot.png' }],
  });
  expect(result.content).toEqual([
    { type: 'text', text: '/ws/shot.png (image/png, 1 KB)' },
    { type: 'image', data: dataUrl.split(',')[1], mimeType: 'image/png' },
  ]);
});

test('drops the image with a note when the model cannot see images', async () => {
  const t = viewImageTool(ctx({ readFileBytes: async () => png() }));
  expect(await runTool(t, { description: 'x', path: 'shot.png' })).toContain('[1 image(s) omitted');
});

test('rejects a file that is not a supported image', async () => {
  const t = viewImageTool(
    ctx({ readFileBytes: async () => new TextEncoder().encode('hello world') }),
  );
  expect(runTool(t, { description: 'x', path: 'notes.txt' })).rejects.toThrow(
    'Not a supported image file',
  );
});

test('rejects an image over the inline limit with a downscale hint', async () => {
  const big = new Uint8Array(3 * 1024 * 1024 + 1);
  big.set([0x89, 0x50, 0x4e, 0x47]);
  const t = viewImageTool(ctx({ readFileBytes: async () => big }));
  expect(runTool(t, { description: 'x', path: 'huge.png' })).rejects.toThrow(
    /over the 3MB inline limit[\s\S]*sips/,
  );
});

test('maps fs errors to model-readable messages', async () => {
  const t = viewImageTool(
    ctx({
      readFileBytes: async () => {
        throw errno('ENOENT');
      },
    }),
  );
  expect(runTool(t, { description: 'x', path: 'missing.png' })).rejects.toThrow(
    'File not found: missing.png',
  );
});
