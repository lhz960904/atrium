import type {
  AssistantMessage,
  Content,
  ImageContent,
  Message,
  TextContent,
} from '@shared/protocol';

/**
 * Token accounting for compaction's threshold check. Not exact — exactness
 * would need a per-provider tokenizer we don't carry. The strategy: anchor on
 * the provider's own count where the transcript carries one, estimate only the
 * tail past it.
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

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

function sizeOfContent(content: readonly (Content | TextContent | ImageContent)[]): {
  text: string;
  images: number;
} {
  let text = '';
  let images = 0;
  for (const part of content) {
    switch (part.type) {
      case 'text':
        text += (part as TextContent).text;
        break;
      case 'thinking':
        text += String((part as { thinking?: unknown }).thinking ?? '');
        break;
      case 'toolCall':
        text += stringify((part as { arguments?: unknown }).arguments);
        break;
      case 'image':
        images++;
        break;
      default:
        // Unknown part types round-trip but carry no measurable prompt weight.
        break;
    }
  }
  return { text, images };
}

/** Size estimate for one message: text-bearing content by length, images flat. */
export function tokensOfMessage(message: Message): number {
  if (message.role === 'user' && typeof message.content === 'string') {
    return estimateTokens(message.content);
  }
  const { text, images } = sizeOfContent(message.content as Content[]);
  return estimateTokens(text) + images * IMAGE_TOKENS;
}

/**
 * The prompt size a finished turn reports: what it was sent, plus what it
 * wrote. `input` alone is not it — a provider that served part of the prompt
 * from its cache bills only the uncached remainder there and puts the rest in
 * `cacheRead`, so a cached turn would read as a fraction of its real size.
 */
function reportedContextTokens(message: Message): number | undefined {
  if (message.role !== 'assistant') return undefined;
  const { usage } = message as AssistantMessage;
  if (!usage) return undefined;
  const total =
    usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return total > 0 ? total : undefined;
}

/**
 * Hybrid count over a transcript. Anchors on the most recent assistant turn,
 * whose usage is the provider's own count of everything through it — system
 * prompt and injected context included — and estimates only what was appended
 * after. Falls back to a full estimate for a transcript no turn has run yet.
 *
 * Anchoring on the *newest* turn is what keeps a fold from repeating: the turn
 * that runs on the folded transcript reports the smaller prompt, and that
 * becomes the anchor for the next check.
 */
export function countTokens(messages: Message[]): number {
  let anchor = -1;
  let base = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const reported = reportedContextTokens(messages[i]);
    if (reported !== undefined) {
      anchor = i;
      base = reported;
      break;
    }
  }
  let tail = 0;
  for (let i = anchor + 1; i < messages.length; i++) tail += tokensOfMessage(messages[i]);
  return base + tail;
}

/** Pure estimate, for a view whose reported counts no longer describe it. */
export function estimateContextTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) total += tokensOfMessage(message);
  return total;
}
