/**
 * Output formatting shared by the file/shell tools. The sandbox returns raw
 * content + throws on error; tools truncate here and turn errors into
 * model-readable `Error: ...` strings.
 */

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
