import type { ModelMessage, UIMessage } from 'ai';

/**
 * Token accounting for compaction's threshold check. Not exact — exactness
 * would need a per-provider tokenizer we don't carry. The strategy (C-5):
 * anchor on the provider's own count where we have it, estimate only the tail.
 */

/** Rough chars-per-token. Only ever applied to the short un-counted tail. */
const CHARS_PER_TOKEN = 4;

/**
 * Flat per-image charge. Providers downscale images to ~1568px (~1.6k tokens),
 * so counting the base64 payload as text would overestimate by two orders of
 * magnitude and trigger folds on every turn that carries a screenshot.
 */
const IMAGE_TOKENS = 1600;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type LoosePart = Record<string, unknown>;
type Cost = { text: string; images: number };

function stringifyField(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Split a tool output into text plus a flat image count when it carries inline
 * images — either the tool's own { text, images } object or, after message
 * conversion, the wire ToolResultOutput ('json' wrapping the object, or
 * 'content' with image parts). Returns null for outputs with no image shape.
 */
function toolOutputCost(output: unknown): Cost | null {
  if (output == null || typeof output !== 'object') return null;
  const o = output as LoosePart;
  if (o.type === 'json') return toolOutputCost(o.value);
  if (typeof o.text === 'string' && Array.isArray(o.images)) {
    return { text: o.text, images: o.images.length };
  }
  if (o.type === 'content' && Array.isArray(o.value)) {
    const cost: Cost = { text: '', images: 0 };
    for (const part of o.value as LoosePart[]) {
      if (typeof part.text === 'string') cost.text += part.text;
      else cost.images += 1;
    }
    return cost;
  }
  return null;
}

function addOutput(cost: Cost, output: unknown): void {
  const c = toolOutputCost(output);
  if (c) {
    cost.text += c.text;
    cost.images += c.images;
  } else {
    cost.text += stringifyField(output);
  }
}

/** Accumulate the bulky fields of a UIMessage's parts. */
function costOfUIMessage(msg: UIMessage): Cost {
  const cost: Cost = { text: '', images: 0 };
  for (const p of (msg.parts ?? []) as LoosePart[]) {
    if (typeof p.text === 'string') cost.text += p.text;
    if ('input' in p) cost.text += stringifyField(p.input);
    if ('output' in p) addOutput(cost, p.output);
    if ('data' in p) cost.text += stringifyField(p.data);
  }
  return cost;
}

/** Accumulate the text-bearing content of a ModelMessage. */
function costOfModelMessage(msg: ModelMessage): Cost {
  const cost: Cost = { text: '', images: 0 };
  const content = msg.content as unknown;
  if (typeof content === 'string') return { text: content, images: 0 };
  if (!Array.isArray(content)) return cost;
  for (const p of content as LoosePart[]) {
    if (typeof p.text === 'string') cost.text += p.text;
    if ('input' in p) cost.text += stringifyField(p.input);
    if ('output' in p) addOutput(cost, p.output);
  }
  return cost;
}

function tokensOf(cost: Cost): number {
  return estimateTokens(cost.text) + cost.images * IMAGE_TOKENS;
}

/** Per-message size estimate, used by window selection. */
export function tokensOfUIMessage(msg: UIMessage): number {
  return tokensOf(costOfUIMessage(msg));
}

export function tokensOfModelMessage(msg: ModelMessage): number {
  return tokensOf(costOfModelMessage(msg));
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
    tail += tokensOfUIMessage(messages[i]);
  }
  return base + tail;
}

/** ModelMessages carry no metadata, so within-turn counting is pure estimate. */
export function countTokensModel(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) total += tokensOfModelMessage(m);
  return total;
}
