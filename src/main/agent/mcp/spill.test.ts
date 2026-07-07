import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spillOversizedImages } from './spill';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'atrium-spill-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const image = (bytes: number, mediaType = 'image/png') => ({
  mediaType,
  // 4 base64 chars per 3 bytes, no padding when bytes % 3 === 0.
  dataUrl: `data:${mediaType};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`,
});

test('passes strings and small images through untouched', async () => {
  expect(await spillOversizedImages('plain', workspace)).toBe('plain');
  const output = { text: 'shot', images: [image(1024)] };
  expect(await spillOversizedImages(output, workspace)).toBe(output);
});

test('writes an oversized image to the workspace media dir and notes the path', async () => {
  // divisible by 3 so the base64 round-trip is byte-exact
  const bytes = 3 * 1024 * 1024 + 3;
  const result = await spillOversizedImages({ text: 'shot', images: [image(bytes)] }, workspace);
  expect(typeof result).toBe('string');
  expect(result).toContain('shot');
  expect(result).toMatch(/\[oversized image saved to .+\.png — use view_image to inspect it\]/);

  const files = await readdir(join(workspace, '.atrium', 'media'));
  expect(files).toHaveLength(1);
  const written = await readFile(join(workspace, '.atrium', 'media', files[0]));
  expect(written.byteLength).toBe(bytes);
});

test('keeps small images while spilling the oversized one', async () => {
  const small = image(300, 'image/jpeg');
  const result = await spillOversizedImages(
    { text: '', images: [small, image(4 * 1024 * 1024)] },
    workspace,
  );
  expect(result).toEqual({
    text: expect.stringMatching(/^\[oversized image saved to .+\.png/),
    images: [small],
  });
});
