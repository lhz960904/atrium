import { normalizedParts, stringifyUnknown } from '@shared/message-parts';
import type { ModelMessage } from 'ai';

/**
 * Token accounting for a nested loop's compaction threshold. Not exact —
 * exactness would need a per-provider tokenizer we don't carry — and a nested
 * run has no reported counts to anchor on, so it is a pure estimate.
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
function tokensOfMessage(msg: ModelMessage): number {
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

export function tokensOfModelMessage(msg: ModelMessage): number {
  return tokensOfMessage(msg);
}

/** ModelMessages carry no metadata, so within-turn counting is pure estimate. */
export function countTokensModel(messages: ModelMessage[]): number {
  let total = 0;
  for (const m of messages) total += tokensOfModelMessage(m);
  return total;
}
