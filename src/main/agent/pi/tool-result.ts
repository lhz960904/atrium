import type { ImageContent, TextContent } from '@shared/protocol';

/**
 * pi reports a failed tool call by flagging the result and putting the reason in
 * the model-facing `content` — a validation error, a thrown tool, a call the
 * permission gate blocked. The tool card reads `details.errorText`, so the
 * reason is lifted there; a tool that already put its own details on the result
 * keeps them.
 */
export function withErrorText(
  details: unknown,
  content: (TextContent | ImageContent)[],
  isError: boolean,
): unknown {
  if (!isError) return details;
  const existing = (details ?? {}) as Record<string, unknown>;
  if (typeof existing.errorText === 'string') return details;
  const text = content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
  return { ...existing, errorText: text || 'Tool failed.' };
}
