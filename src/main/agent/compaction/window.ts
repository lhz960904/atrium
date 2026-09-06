import type { ModelMessage } from 'ai';
import { tokensOfModelMessage } from './tokens';

export type WindowOptions = { keepRecentTokens: number; minKeepMessages: number };

/** Count from the tail until the token budget is met, never below minKeep. */
function keptCount(sizeAt: (i: number) => number, length: number, opts: WindowOptions): number {
  let kept = 0;
  let tokens = 0;
  for (let i = length - 1; i >= 0; i--) {
    tokens += sizeAt(i);
    kept++;
    if (tokens >= opts.keepRecentTokens && kept >= opts.minKeepMessages) break;
  }
  return kept;
}

/**
 * Recent window over ModelMessages. Here tool results are separate `role:'tool'`
 * messages whose matching tool-call sits in the preceding assistant, so the
 * window must not begin with an orphan tool message: after picking by budget,
 * walk the cut backward past any leading tool message onto its owning
 * assistant, landing on a clean turn boundary.
 */
export function pickRecentWindowModel(
  messages: ModelMessage[],
  opts: WindowOptions,
): ModelMessage[] {
  if (messages.length <= opts.minKeepMessages) return messages.slice();
  const kept = keptCount((i) => tokensOfModelMessage(messages[i]), messages.length, opts);
  let cut = messages.length - kept;
  while (cut > 0 && messages[cut].role === 'tool') cut--;
  return messages.slice(cut);
}
