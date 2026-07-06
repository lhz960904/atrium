import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageToolOutput, ToolResultImage } from '@shared/chat-types';

/**
 * Inline cap per image. Anthropic rejects images over 5MB and downscales past
 * ~1568px anyway, so beyond this size the base64 only bloats the message store
 * and stream with no model-side gain — the image goes to disk instead.
 */
const INLINE_MAX_BYTES = 3 * 1024 * 1024;

/** Where oversized tool images land, relative to the thread's workspace. */
const MEDIA_DIR = join('.atrium', 'media');

function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function rawBytesOf(dataUrl: string): number {
  // 4 base64 chars encode 3 bytes; ignoring padding overcounts by at most 2.
  return Math.floor((base64Of(dataUrl).length * 3) / 4);
}

function extensionOf(mediaType: string): string {
  const subtype = mediaType.split('/')[1] ?? 'bin';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}

let sequence = 0;

async function writeImage(image: ToolResultImage, workspaceRoot: string): Promise<string> {
  const dir = join(workspaceRoot, MEDIA_DIR);
  await mkdir(dir, { recursive: true });
  const name = `tool-image-${Date.now().toString(36)}-${sequence++}.${extensionOf(image.mediaType)}`;
  const path = join(dir, name);
  await writeFile(path, Buffer.from(base64Of(image.dataUrl), 'base64'));
  return path;
}

/**
 * Split oversized images out of a structured output: each is written under the
 * workspace's media dir and replaced by a note carrying the absolute path, so
 * the model can still reach the pixels without megabytes inline. A failed write
 * degrades to an omission note rather than failing the tool call.
 */
export async function spillOversizedImages(
  output: string | ImageToolOutput,
  workspaceRoot: string,
): Promise<string | ImageToolOutput> {
  if (typeof output === 'string') return output;
  const keep: ToolResultImage[] = [];
  const notes: string[] = [];
  for (const image of output.images) {
    if (rawBytesOf(image.dataUrl) <= INLINE_MAX_BYTES) {
      keep.push(image);
      continue;
    }
    try {
      const path = await writeImage(image, workspaceRoot);
      notes.push(`[oversized image saved to ${path} — use view_image to inspect it]`);
    } catch (err) {
      notes.push(`[oversized image omitted: saving it failed (${(err as Error).message})]`);
    }
  }
  if (notes.length === 0) return output;
  const text = [output.text, ...notes].filter(Boolean).join('\n');
  return keep.length > 0 ? { text, images: keep } : text;
}
