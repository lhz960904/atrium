import type { ImageToolOutput } from '@shared/chat-types';
import type { Tool } from 'ai';

/**
 * Output formatting shared by the file/shell tools. The sandbox returns raw
 * content + throws on error; tools truncate here and turn errors into
 * model-readable `Error: ...` strings.
 */

type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>;

/** Keep the start; append a marker telling the model what was cut + a hint. */
export function headTruncate(s: string, max: number, hint: string): string {
  if (max <= 0 || s.length <= max) return s;
  return `${s.slice(0, max)}\n... [truncated: showing first ${max} of ${s.length} chars. ${hint}] ...`;
}

/** Keep head + tail (output ordering isn't meaningful, so preserve both ends). */
export function middleTruncate(s: string, max: number): string {
  if (max <= 0 || s.length <= max) return s;
  const head = Math.floor(max / 2);
  const tail = max - head;
  return `${s.slice(0, head)}\n... [middle truncated: ${s.length - max} chars skipped] ...\n${s.slice(-tail)}`;
}

/**
 * Map a tool output onto the wire format. Plain strings (text-only results and
 * pre-image history rows) go out as text. Structured outputs inline their
 * images as image-data parts — unless the provider+model can't consume image
 * tool results, in which case the images are dropped with an explicit note so
 * the model knows what it isn't seeing. Shared by the MCP adapter and the
 * view_image builtin, which return the same { text, images } shape.
 */
export function imageOutputToModelOutput(
  output: unknown,
  imageToolResults: boolean,
): ToolResultOutput {
  if (typeof output === 'string') return { type: 'text', value: output };
  const { text, images } = output as ImageToolOutput;
  if (!imageToolResults) {
    const note = `[${images.length} image(s) omitted: the current model cannot view images]`;
    return { type: 'text', value: text ? `${text}\n${note}` : note };
  }
  return {
    type: 'content',
    value: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((img) => ({
        type: 'image-data' as const,
        data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1),
        mediaType: img.mediaType,
      })),
    ],
  };
}

/**
 * Map a Node fs error to a model-readable message, shared by the single-file
 * tools (read/write/edit). `verb` only varies the EACCES phrasing (e.g.
 * 'reading', 'writing to', 'editing'); the code mapping is identical. Directory
 * tools keep their own mapper — different codes (ENOTDIR) and wording.
 */
export function fsErrorMessage(err: unknown, path: string, verb: string): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return `Error: File not found: ${path}`;
  if (code === 'EACCES') return `Error: Permission denied ${verb} file: ${path}`;
  if (code === 'EISDIR') return `Error: Path is a directory, not a file: ${path}`;
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}
