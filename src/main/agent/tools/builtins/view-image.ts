import { basename } from 'node:path';
import { resolveAbsolute } from '../../sandbox/paths';
import type { ToolCtx } from '../context';
import { defineTool, imageResult, Type } from '../define';
import { fsError, IMAGE_INLINE_MAX_BYTES } from '../output';

/**
 * Magic-byte signatures for the image formats vision providers accept
 * (Anthropic/Google take png, jpeg, gif, webp). Each entry lists byte runs that
 * must match at fixed offsets — WEBP is RIFF<size>WEBP, hence two runs. We
 * sniff contents rather than trust the extension: extensions lie.
 */
type ByteRun = { offset: number; bytes: number[] };
const SIGNATURES: Array<{ mediaType: string; runs: ByteRun[] }> = [
  { mediaType: 'image/png', runs: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  { mediaType: 'image/jpeg', runs: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mediaType: 'image/gif', runs: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  {
    mediaType: 'image/webp',
    runs: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

function sniffMediaType(data: Uint8Array): string | null {
  const matches = (run: ByteRun) => run.bytes.every((b, i) => data[run.offset + i] === b);
  return SIGNATURES.find((s) => s.runs.every(matches))?.mediaType ?? null;
}

export const viewImageTool = (ctx: ToolCtx) =>
  defineTool({
    name: 'view_image',
    label: 'View image',
    description:
      'View an image file (png, jpeg, gif, webp) from disk so it becomes visible in the ' +
      'conversation — e.g. a screenshot or picture another tool saved. Not for text files.',
    parameters: Type.Object({
      description: Type.String({
        description: 'Why you are viewing this image, in short words. ALWAYS PROVIDE THIS FIRST.',
      }),
      path: Type.String({ description: 'Absolute path to the image file.' }),
    }),
    execute: async (_id, { path }) => {
      const abs = resolveAbsolute(ctx.workspaceRoot, path);
      let bytes: Uint8Array;
      try {
        bytes = await ctx.sandbox.readFileBytes(abs);
      } catch (err) {
        throw fsError(err, path, 'reading');
      }
      const mediaType = sniffMediaType(bytes);
      if (!mediaType) {
        throw new Error(`Not a supported image file (png, jpeg, gif, webp): ${path}`);
      }
      if (bytes.byteLength > IMAGE_INLINE_MAX_BYTES) {
        const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
        throw new Error(
          `Image is ${mb}MB, over the 3MB inline limit. Downscale it first (e.g. \`sips -Z 1568 <file> --out <smaller copy>\`) and view the smaller copy.`,
        );
      }
      const kb = Math.max(1, Math.round(bytes.byteLength / 1024));
      return imageResult(
        {
          text: `${abs} (${mediaType}, ${kb} KB)`,
          images: [
            {
              mediaType,
              dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
              filename: basename(abs),
            },
          ],
        },
        ctx.supportsImageToolResults ?? false,
      );
    },
  });
