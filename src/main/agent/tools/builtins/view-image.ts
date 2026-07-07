import { basename } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { fsErrorMessage, imageOutputToModelOutput } from '../output';

// Matches the MCP inline cap: past this the base64 bloats the store and stream,
// and Anthropic rejects images over 5MB anyway.
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

const SIGNATURES: Array<{ mediaType: string; matches: (b: Uint8Array) => boolean }> = [
  {
    mediaType: 'image/png',
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mediaType: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mediaType: 'image/gif',
    matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mediaType: 'image/webp',
    matches: (b) =>
      b.length > 11 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/** Sniff the media type from magic bytes — extensions lie, file contents don't. */
function sniffMediaType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  return SIGNATURES.find((s) => s.matches(bytes))?.mediaType ?? null;
}

export const viewImageTool = (ctx: ToolCtx) =>
  tool({
    description:
      'View an image file (png, jpeg, gif, webp) from disk so it becomes visible in the ' +
      'conversation — e.g. a screenshot or picture another tool saved. Not for text files.',
    inputSchema: z.object({
      description: z
        .string()
        .describe('Why you are viewing this image, in short words. ALWAYS PROVIDE THIS FIRST.'),
      path: z.string().describe('Absolute path to the image file.'),
    }),
    execute: async ({ path }) => {
      try {
        const abs = resolveAbsolute(ctx.workspaceRoot, path);
        const bytes = await ctx.sandbox.readFileBytes(abs);
        const mediaType = sniffMediaType(bytes);
        if (!mediaType) {
          return `Error: Not a supported image file (png, jpeg, gif, webp): ${path}`;
        }
        if (bytes.byteLength > IMAGE_MAX_BYTES) {
          const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
          return `Error: Image is ${mb}MB, over the 3MB inline limit. Downscale it first (e.g. \`sips -Z 1568 <file> --out <smaller copy>\`) and view the smaller copy.`;
        }
        const kb = Math.max(1, Math.round(bytes.byteLength / 1024));
        return {
          text: `${abs} (${mediaType}, ${kb} KB)`,
          images: [
            {
              mediaType,
              dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
              filename: basename(abs),
            },
          ],
        };
      } catch (err) {
        return fsErrorMessage(err, path, 'reading');
      }
    },
    toModelOutput: ({ output }) => imageOutputToModelOutput(output, ctx.imageToolResults ?? false),
  });
