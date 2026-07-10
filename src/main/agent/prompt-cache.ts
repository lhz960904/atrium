import type { ModelMessage } from 'ai';
import { getProviderManifest } from '../providers/manifest';

/**
 * Whether prompt caching for this provider needs explicit markers. On the
 * Anthropic protocol nothing is cached unless a message carries a
 * cache_control breakpoint — omit them and every step re-bills the full,
 * growing history as fresh input. (OpenAI-compatible and Gemini endpoints
 * cache prefixes implicitly, so they need no markers.)
 */
export function usesAnthropicPromptCache(providerId?: string): boolean {
  const manifest = providerId ? getProviderManifest(providerId) : undefined;
  return manifest?.kind === 'cloud-api' && manifest.protocol === 'anthropic';
}

/**
 * Stamp ephemeral cache breakpoints on the last two messages — Anthropic's
 * documented incremental-caching pattern for conversations. A breakpoint on
 * the tail caches the entire prefix (tools + system + history) as one entry,
 * and the next step's longer prompt reuses it as its longest cached prefix;
 * the second breakpoint keeps the previous position addressable across a
 * retried or branched step. Messages are copied, not mutated: the loop's own
 * message array never carries stamps, so breakpoints can't accumulate on old
 * positions past Anthropic's four-marker limit as the tail moves.
 */
export function stampCacheBreakpoints(messages: ModelMessage[]): ModelMessage[] {
  const stampFrom = Math.max(0, messages.length - 2);
  return messages.map((message, i) =>
    i < stampFrom
      ? message
      : {
          ...message,
          providerOptions: {
            ...message.providerOptions,
            anthropic: {
              ...message.providerOptions?.anthropic,
              cacheControl: { type: 'ephemeral' },
            },
          },
        },
  );
}
