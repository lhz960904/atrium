import { normalizedParts, stringifyUnknown } from '@shared/message-parts';
import type { ModelMessage, UIMessage } from 'ai';

/**
 * Token accounting for compaction's threshold check. Not exact — exactness
 * would need a per-provider tokenizer we don't carry. The strategy:
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

/**
 * Size estimate over the normalized parts of a message, either family.
 * Text-bearing content counts by length; tool-result images count flat.
 */
function tokensOfMessage(msg: UIMessage | ModelMessage): number {
  let text = '';
  let images = 0;
  for (const part of normalizedParts(msg)) {
    switch (part.kind) {
      case 'text':
      case 'reasoning':
        text += part.text;
        break;
      case 'tool-call':
        text += stringifyUnknown(part.input);
        break;
      case 'tool-result':
        text += part.output.text;
        images += part.output.images.length;
        break;
      case 'data':
        text += stringifyUnknown(part.data);
        break;
      default:
        // Attached files/sources aren't counted, matching the pre-normalized
        // estimate; tool-result images are the ones that dominate real prompts.
        break;
    }
  }
  return estimateTokens(text) + images * IMAGE_TOKENS;
}

/** Per-message size estimate, used by window selection. */
export function tokensOfUIMessage(msg: UIMessage): number {
  return tokensOfMessage(msg);
}

export function tokensOfModelMessage(msg: ModelMessage): number {
  return tokensOfMessage(msg);
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
