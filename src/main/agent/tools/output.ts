/**
 * Output formatting shared by the file/shell tools. The sandbox returns raw
 * content and throws on error; tools truncate here and rethrow failures with a
 * model-readable message (the loop encodes the throw as an error result).
 */

/**
 * Cap for images carried inline as base64 (MCP results, view_image). Past this
 * they spill to disk instead: Anthropic rejects images over 5MB and downscales
 * past ~1568px anyway, so bigger payloads only bloat the store and stream.
 */
export const IMAGE_INLINE_MAX_BYTES = 3 * 1024 * 1024;

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
 * Map a Node fs error to a model-readable one, shared by the single-file tools
 * (read/write/edit). `verb` only varies the EACCES phrasing (e.g. 'reading',
 * 'writing to', 'editing'); the code mapping is identical. Directory tools keep
 * their own mapper — different codes (ENOTDIR) and wording.
 */
export function fsError(err: unknown, path: string, verb: string): Error {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return new Error(`File not found: ${path}`);
  if (code === 'EACCES') return new Error(`Permission denied ${verb} file: ${path}`);
  if (code === 'EISDIR') return new Error(`Path is a directory, not a file: ${path}`);
  return err instanceof Error ? err : new Error(String(err));
}
