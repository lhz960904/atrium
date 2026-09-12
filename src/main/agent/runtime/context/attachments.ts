import type { Content, Message } from '@shared/protocol';

/**
 * The composer stores an attachment as a UI file part — name, media type and a
 * self-contained data URL — so a reloaded thread can rebuild its chip without
 * the original file. The engine's content vocabulary has no such member: its
 * block mapper treats every non-text content as an image and reads `mimeType`
 * and `data`, so a file part arrives at the provider as an image with both
 * fields empty and the whole request is rejected.
 *
 * Attachments are therefore translated on the way to the model and only there.
 * The stored row keeps the shape the renderer round-trips, which also means
 * threads written before this conversion existed need no migration.
 */

type FilePart = { type: 'file'; url?: string; mediaType?: string; filename?: string };

const isFilePart = (content: unknown): content is FilePart =>
  typeof content === 'object' &&
  content !== null &&
  (content as { type?: unknown }).type === 'file';

/** The base64 payload of a data URL, or null for any other URL form. */
function payloadOf(url: string | undefined): string | null {
  if (!url?.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  return comma === -1 ? null : url.slice(comma + 1);
}

const describe = (part: FilePart): string =>
  `${part.filename ?? 'attachment'} (${part.mediaType ?? 'unknown type'})`;

const note = (text: string): Content => ({ type: 'text', text }) as Content;

/**
 * One attachment as content the model can actually read. Images go multimodal.
 * Text-classified files (the composer reads code, markdown and svg as text) are
 * decoded and labelled, since their bytes are only useful as source. Anything
 * else — a PDF today — has no representation in the engine's content union, so
 * it becomes a note naming the file: the model can then say what it can't read
 * instead of the turn failing.
 */
function toModelContent(part: FilePart): Content {
  const data = payloadOf(part.url);
  const mimeType = part.mediaType;
  if (data === null || !mimeType) return note(`[attachment ${describe(part)} could not be read]`);
  if (mimeType.startsWith('image/')) return { type: 'image', data, mimeType } as Content;
  if (mimeType.startsWith('text/')) {
    const text = Buffer.from(data, 'base64').toString('utf8');
    return note(`<attachment name="${part.filename ?? 'file'}">\n${text}\n</attachment>`);
  }
  return note(`[attachment ${describe(part)} — this model cannot read this file type]`);
}

/** The same message with every attachment converted; untouched when it has none. */
export function withModelAttachments(message: Message): Message {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content) || !content.some(isFilePart)) return message;
  return {
    ...message,
    content: content.map((part) => (isFilePart(part) ? toModelContent(part) : part)),
  } as Message;
}
