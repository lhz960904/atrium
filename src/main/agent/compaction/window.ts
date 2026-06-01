import type { ModelMessage, UIMessage } from 'ai';
import { tokensOfModelMessage, tokensOfUIMessage } from './tokens';

export type Checkpoint = { index: number; message: UIMessage };

/** Latest persisted compaction checkpoint (the summary `user` message). */
export function findLatestCheckpoint(messages: UIMessage[]): Checkpoint | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const kind = (messages[i].metadata as { kind?: unknown } | undefined)?.kind;
    if (kind === 'compaction') return { index: i, message: messages[i] };
  }
  return undefined;
}

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
 * Recent window to keep un-summarized. UIMessages are self-contained — a tool
 * call and its result live within one assistant message's parts — so any
 * suffix is a legal cut, no pair can be split.
 */
export function pickRecentWindow(messages: UIMessage[], opts: WindowOptions): UIMessage[] {
  if (messages.length <= opts.minKeepMessages) return messages.slice();
  const kept = keptCount((i) => tokensOfUIMessage(messages[i]), messages.length, opts);
  return messages.slice(messages.length - kept);
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
