import { getToolName, isDataUIPart, isToolUIPart, type ModelMessage, type UIMessage } from 'ai';
import { isImageToolOutput, type ToolResultImage } from './chat-types';

/**
 * One traversal layer over both message families. UIMessages (persisted chat
 * history) and ModelMessages (the within-turn wire form) carry the same
 * conversation content in different shapes — parts vs content, merged tool
 * parts vs split tool-call/tool-result, three tool-output encodings. Every
 * consumer that walks a conversation (token estimation, transcript rendering,
 * markdown export, text extraction) reads the normalized parts produced here
 * instead of re-implementing the shape dispatch.
 *
 * A UIMessage tool part that already has its result yields two parts — a
 * `tool-call` then a `tool-result` — matching the ModelMessage form, so
 * consumers handle one sequence regardless of family.
 */

export type NormalizedToolOutput = {
  /** The output's textual payload, unwrapped from its wire encoding. */
  text: string;
  /** Inline images/files the output carried; base64 never leaks into `text`. */
  images: ToolResultImage[];
  error?: boolean;
};

export type NormalizedPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-call'; name: string; input: unknown }
  | { kind: 'tool-result'; name: string; output: NormalizedToolOutput }
  | { kind: 'file'; mediaType?: string; url?: string; filename?: string }
  | { kind: 'source'; title?: string; url?: string; filename?: string }
  | { kind: 'data'; dataType: string; data: unknown };

/** JSON-stringify arbitrary content for size/transcript purposes; never throws. */
export function stringifyUnknown(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

type LooseObject = Record<string, unknown>;

/**
 * Unwrap a tool output into text plus inline images. Handles every encoding a
 * result reaches us in: the wire ToolResultOutput variants ('text', 'json',
 * 'error-text', 'error-json', 'content', 'execution-denied'), the structured
 * { text, images } object our image-bearing tools return (which 'json' wraps
 * after message conversion), and plain strings/objects from UI tool parts.
 */
export function normalizeToolOutput(output: unknown): NormalizedToolOutput {
  if (output == null) return { text: '', images: [] };
  if (typeof output !== 'object') return { text: String(output), images: [] };
  if (isImageToolOutput(output)) return { text: output.text, images: output.images };
  const o = output as LooseObject;
  switch (o.type) {
    case 'json':
      return normalizeToolOutput(o.value);
    case 'text':
      return { text: String(o.value ?? ''), images: [] };
    case 'error-text':
      return { text: String(o.value ?? ''), images: [], error: true };
    case 'error-json':
      return { text: stringifyUnknown(o.value), images: [], error: true };
    case 'execution-denied':
      return {
        text: typeof o.reason === 'string' ? o.reason : 'Tool execution denied.',
        images: [],
        error: true,
      };
    case 'content':
      if (Array.isArray(o.value)) return normalizeContentEntries(o.value as LooseObject[]);
      break;
  }
  return { text: stringifyUnknown(output), images: [] };
}

/**
 * Flatten a 'content'-type output: text entries join the text, everything else
 * (media / file-data / file-url / file-id) becomes an image entry — media
 * attachments are overwhelmingly images here, and callers that only need a
 * size signal count entries rather than inspect them.
 */
function normalizeContentEntries(entries: LooseObject[]): NormalizedToolOutput {
  const texts: string[] = [];
  const images: ToolResultImage[] = [];
  for (const entry of entries) {
    if (typeof entry.text === 'string') {
      texts.push(entry.text);
    } else {
      const mediaType = typeof entry.mediaType === 'string' ? entry.mediaType : '';
      const data = typeof entry.data === 'string' ? entry.data : undefined;
      const url = typeof entry.url === 'string' ? entry.url : undefined;
      images.push({
        mediaType,
        dataUrl: url ?? (data != null ? `data:${mediaType};base64,${data}` : ''),
        filename: typeof entry.filename === 'string' ? entry.filename : undefined,
      });
    }
  }
  return { text: texts.join('\n'), images };
}

/** Normalized conversation content of a message, either family. */
export function normalizedParts(msg: UIMessage | ModelMessage): NormalizedPart[] {
  return 'parts' in msg ? fromUIParts(msg.parts) : fromModelContent(msg.content);
}

function fromUIParts(parts: UIMessage['parts']): NormalizedPart[] {
  const out: NormalizedPart[] = [];
  // Defensive ?? []: persisted rows and test fixtures can lack the field.
  for (const part of parts ?? []) {
    if (part.type === 'text') {
      out.push({ kind: 'text', text: part.text });
    } else if (part.type === 'reasoning') {
      out.push({ kind: 'reasoning', text: part.text });
    } else if (part.type === 'file') {
      out.push({
        kind: 'file',
        mediaType: part.mediaType,
        url: part.url,
        filename: part.filename,
      });
    } else if (part.type === 'source-url') {
      out.push({ kind: 'source', title: part.title, url: part.url });
    } else if (part.type === 'source-document') {
      out.push({ kind: 'source', title: part.title, filename: part.filename });
    } else if (isToolUIPart(part)) {
      const name = getToolName(part);
      out.push({ kind: 'tool-call', name, input: part.input });
      // Presence-checked rather than state-gated: loosely-shaped parts (fixtures,
      // mock threads) carry an output without the state machine fields.
      if (part.output !== undefined) {
        out.push({ kind: 'tool-result', name, output: normalizeToolOutput(part.output) });
      } else if (part.state === 'output-error') {
        out.push({
          kind: 'tool-result',
          name,
          output: { text: part.errorText, images: [], error: true },
        });
      }
    } else if (isDataUIPart(part)) {
      out.push({ kind: 'data', dataType: part.type.slice('data-'.length), data: part.data });
    }
    // step-start carries no content.
  }
  return out;
}

function fromModelContent(content: ModelMessage['content']): NormalizedPart[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  const out: NormalizedPart[] = [];
  for (const part of content) {
    switch (part.type) {
      case 'text':
      case 'reasoning':
        out.push({ kind: part.type, text: part.text });
        break;
      case 'tool-call':
        out.push({ kind: 'tool-call', name: part.toolName, input: part.input });
        break;
      case 'tool-result':
        out.push({
          kind: 'tool-result',
          name: part.toolName,
          output: normalizeToolOutput(part.output),
        });
        break;
      case 'image':
        out.push({
          kind: 'file',
          mediaType: part.mediaType,
          url: typeof part.image === 'string' ? part.image : undefined,
        });
        break;
      case 'file':
        out.push({
          kind: 'file',
          mediaType: part.mediaType,
          url: typeof part.data === 'string' ? part.data : undefined,
          filename: part.filename,
        });
        break;
      default:
        // Approval bookkeeping parts carry no conversation content.
        break;
    }
  }
  return out;
}

/** Concatenated plain text of a message's text parts. */
export function textOfMessage(msg: UIMessage | ModelMessage, separator = ''): string {
  return normalizedParts(msg)
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join(separator)
    .trim();
}
