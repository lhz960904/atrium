import type { ModelMessage, UIMessage } from 'ai';

/**
 * Token accounting for compaction's threshold check. Not exact — exactness
 * would need a per-provider tokenizer we don't carry. The strategy (C-5):
 * anchor on the provider's own count where we have it, estimate only the tail.
 */

/** Rough chars-per-token. Only ever applied to the short un-counted tail. */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type LoosePart = Record<string, unknown>;

function stringifyField(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Concatenate the bulky text-bearing fields of a UIMessage's parts. */
function messageTextUI(msg: UIMessage): string {
  const parts = (msg.parts ?? []) as LoosePart[];
  let out = '';
  for (const p of parts) {
    if (typeof p.text === 'string') out += p.text;
    if ('input' in p) out += stringifyField(p.input);
    if ('output' in p) out += stringifyField(p.output);
    if ('data' in p) out += stringifyField(p.data);
  }
  return out;
}

/** Concatenate the text-bearing content of a ModelMessage. */
function messageTextModel(msg: ModelMessage): string {
  const content = msg.content as unknown;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const p of content as LoosePart[]) {
    if (typeof p.text === 'string') out += p.text;
    if ('input' in p) out += stringifyField(p.input);
    if ('output' in p) out += stringifyField(p.output);
  }
  return out;
}

/** Per-message size estimate, used by window selection. */
export function tokensOfUIMessage(msg: UIMessage): number {
  return estimateTokens(messageTextUI(msg));
}

export function tokensOfModelMessage(msg: ModelMessage): number {
  return estimateTokens(messageTextModel(msg));
}

function contextTokensOf(msg: UIMessage): number | undefined {
  const n = (msg.metadata as { contextTokens?: unknown } | undefined)?.contextTokens;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Hybrid count over the message history. Anchors on the most recent message
 * carrying a provider-derived `contextTokens` (system + history through that
 * message, exact) and estimates only the messages appended after it. Falls
 * back to a full estimate when nothing has been counted yet.
 */
export function countTokens(messages: UIMessage[]): number {
  let anchor = -1;
  let base = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = contextTokensOf(messages[i]);
    if (c !== undefined) {
      anchor = i;
      base = c;
      break;
    }
  }
  let tail = 0;
  for (let i = anchor + 1; i < messages.length; i++) {
    tail += estimateTokens(messageTextUI(messages[i]));
  }
  return base + tail;
}

/** ModelMessages carry no metadata, so within-turn counting is pure estimate. */
export function countTokensModel(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(messageTextModel(m));
  return total;
}
