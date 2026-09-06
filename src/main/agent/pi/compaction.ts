import type {
  AssistantMessage,
  Content,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from '@shared/protocol';
import { createLogger } from '../../log';
import type { ContextTransform } from './context';
import type { Summarize } from './summarize';
import { countTokens, estimateContextTokens } from './tokens';
import { asPi, asStored } from './vocabulary';

const log = createLogger('compaction');

export const SUMMARY_PREAMBLE =
  'Earlier conversation was compacted to save context. Summary of what came before:\n\n';
const ACK_TEXT = 'Understood — I have the summary above and will continue from here.';

export const COMPACT_AT_RATIO = 0.8;
const KEEP_RECENT_RATIO = 0.25;
const MIN_KEEP_MESSAGES = 4;
// Compaction is an optimization, never load-bearing: if the summary call hangs
// or errors, we abandon it and run the turn on the un-compacted messages.
// Generous because cross-border access to a hosted model can be slow.
const SUMMARY_TIMEOUT_MS = 60_000;

/**
 * A feature's hook for surviving compaction. When its state (a plan, an active
 * skill, …) is about to be folded away, it returns the text to carry forward
 * into the summary, or null when there's nothing to preserve — the kept window
 * already holds it, say. Compaction runs every configured preserver and appends
 * their output; it never needs to know what a feature's state is.
 */
export type ContextPreserver = (fold: Message[], recent: Message[]) => string | null;

// ---------------------------------------------------------------------------
// window selection
// ---------------------------------------------------------------------------

export type WindowOptions = { keepRecentTokens: number; minKeepMessages: number };

/** Count back from the tail until the token budget is met, never below minKeep. */
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

const sizeOf = (messages: Message[]) => (i: number) => estimateContextTokens([messages[i]]);

/**
 * The window a persisted checkpoint keeps verbatim. The cut walks back to a
 * user turn, so the prepended [summary(user), ack(assistant)] pair keeps the
 * roles alternating and no tool result is ever separated from its call.
 */
export function pickRecentWindow(messages: Message[], opts: WindowOptions): Message[] {
  if (messages.length <= opts.minKeepMessages) return messages.slice();
  let cut = messages.length - keptCount(sizeOf(messages), messages.length, opts);
  while (cut > 0 && messages[cut].role !== 'user') cut--;
  return messages.slice(cut);
}

/**
 * The window a within-turn fold keeps. A turn has no user message to cut on, so
 * the cut instead walks back off any leading tool result onto the assistant that
 * asked for it — a result whose call was folded away would be an orphan the
 * provider rejects.
 */
export function pickRecentTail(messages: Message[], opts: WindowOptions): Message[] {
  if (messages.length <= opts.minKeepMessages) return messages.slice();
  let cut = messages.length - keptCount(sizeOf(messages), messages.length, opts);
  while (cut > 0 && messages[cut].role === 'toolResult') cut--;
  return messages.slice(cut);
}

/** Token-budgeted split of a region into [fold, recent]; null when nothing to fold. */
function selectFold(
  region: Message[],
  pick: (m: Message[], o: WindowOptions) => Message[],
  opts: WindowOptions,
): { fold: Message[]; recent: Message[] } | null {
  const recent = pick(region, opts);
  const fold = region.slice(0, region.length - recent.length);
  return fold.length === 0 ? null : { fold, recent };
}

// ---------------------------------------------------------------------------
// transcript rendering
// ---------------------------------------------------------------------------

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * Inline images must never reach the summarizer — they would bloat the prompt
 * with megabytes of undecodable base64, and the summary model may lack vision
 * anyway. Render a count instead, so the summary knows something visual
 * happened.
 */
function renderContent(content: readonly (Content | TextContent | ImageContent)[]): string {
  const lines: string[] = [];
  let images = 0;
  for (const part of content) {
    switch (part.type) {
      case 'text':
        lines.push((part as TextContent).text);
        break;
      case 'thinking':
        lines.push(String((part as { thinking?: unknown }).thinking ?? ''));
        break;
      case 'toolCall': {
        const call = part as { name?: unknown; arguments?: unknown };
        lines.push(`[tool ${String(call.name)}] ${stringify(call.arguments)}`);
        break;
      }
      case 'image':
        images++;
        break;
      default:
        lines.push(`[${part.type}]`);
        break;
    }
  }
  if (images > 0) lines.push(`[${images} image(s) omitted]`);
  return lines.filter(Boolean).join('\n');
}

function renderMessage(message: Message): string {
  if (message.role === 'toolResult') {
    const result = message as ToolResultMessage;
    return `## toolResult\n[tool result ${result.toolName}] ${renderContent(result.content)}`;
  }
  const content =
    typeof message.content === 'string'
      ? message.content
      : renderContent(message.content as Content[]);
  return `## ${message.role}\n${content}`;
}

/**
 * Flatten a fold into a plain-text transcript. Flattening sidesteps
 * cross-provider role-alternation and dangling tool-call pitfalls, and a
 * summary is prose anyway.
 */
export function renderTranscript(messages: Message[]): string {
  return messages.map(renderMessage).join('\n\n');
}

// ---------------------------------------------------------------------------
// summarizing a fold
// ---------------------------------------------------------------------------

const isText = (t: string | null): t is string => t !== null;

async function summarizeFold(
  fold: Message[],
  recent: Message[],
  summarize: Summarize,
  preservers: ContextPreserver[],
): Promise<string> {
  const carried = preservers.map((p) => p(fold, recent)).filter(isText);
  const summary = await summarize(renderTranscript(fold), AbortSignal.timeout(SUMMARY_TIMEOUT_MS));
  return [SUMMARY_PREAMBLE + summary, ...carried].join('\n\n');
}

/** The persisted pair a fold leaves behind: the summary, and the ack that keeps roles alternating. */
export type Checkpoint = { summary: UserMessage; ack: AssistantMessage; coveredThrough: number };

const checkpointPair = (text: string, coveredThrough: number): Checkpoint => ({
  summary: { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() },
  ack: {
    role: 'assistant',
    content: [{ type: 'text', text: ACK_TEXT }],
    api: '',
    provider: '',
    model: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  },
  coveredThrough,
});

export type FoldOptions = {
  messages: Message[];
  summarize: Summarize;
  contextWindow: number;
  preservers?: ContextPreserver[];
  /** Recent-window token budget; defaults to a quarter of the window. */
  keepRecentTokens?: number;
  minKeepMessages?: number;
};

/**
 * Fold a transcript into a checkpoint, ignoring the trigger threshold — the
 * caller decides when. Returns the pair to persist plus the window it keeps, or
 * null when there is nothing left to fold.
 */
export async function foldToCheckpoint(
  opts: FoldOptions,
): Promise<{ checkpoint: Checkpoint; recent: Message[] } | null> {
  const selected = selectFold(opts.messages, pickRecentWindow, {
    keepRecentTokens: opts.keepRecentTokens ?? Math.floor(opts.contextWindow * KEEP_RECENT_RATIO),
    minKeepMessages: opts.minKeepMessages ?? MIN_KEEP_MESSAGES,
  });
  if (!selected) return null;
  const { fold, recent } = selected;
  const text = await summarizeFold(fold, recent, opts.summarize, opts.preservers ?? []);
  return { checkpoint: checkpointPair(text, fold.length - 1), recent };
}

/**
 * Summarize the history when it nears the context window, keeping a recent
 * window verbatim. Persisting the pair is what makes it worth doing: later
 * turns reuse the checkpoint instead of re-summarizing, and the folded messages
 * stay in the DB — only what the model is shown gets shorter.
 *
 * Never load-bearing: a failed or slow summary leaves the transcript whole.
 */
export async function compactForTurn(
  opts: FoldOptions & {
    emit: (phase: 'start' | 'done') => void;
    persist: (checkpoint: Checkpoint) => void;
  },
): Promise<Message[]> {
  const tokens = countTokens(opts.messages);
  if (tokens < opts.contextWindow * COMPACT_AT_RATIO) return opts.messages;

  log.info(`cross-turn fold (${tokens}/${opts.contextWindow} tokens)`);
  opts.emit('start');
  try {
    const folded = await foldToCheckpoint(opts);
    if (!folded) return opts.messages;
    opts.persist(folded.checkpoint);
    return [folded.checkpoint.summary, folded.checkpoint.ack, ...folded.recent];
  } catch (err) {
    log.warn(`cross-turn fold failed, proceeding uncompacted: ${(err as Error).message}`);
    return opts.messages;
  } finally {
    opts.emit('done');
  }
}

// ---------------------------------------------------------------------------
// within-turn folding
// ---------------------------------------------------------------------------

/**
 * A single tool loop can balloon past the window before the turn ever ends, so
 * the request view folds too. The fold is remembered as [summary, coveredCount]
 * and every later request deterministically rebuilds [summary, …live tail] from
 * it, keeping the prefix byte-stable for the provider's cache; it re-summarizes
 * only once the tail itself grows past the threshold.
 *
 * Nothing here is persisted — the stored turn is assembled from the real
 * messages — and nothing is announced: compaction shows in the UI only at a
 * turn boundary, where a checkpoint actually lands.
 *
 * `overhead` is the standing context injected downstream of this transform
 * (skills, memory, instructions, profile). It is not in the messages yet but it
 * is in every real prompt, so the threshold has to account for it.
 */
export function withinTurnFold(opts: {
  summarize: Summarize;
  contextWindow: number;
  overheadTokens?: number;
  preservers?: ContextPreserver[];
  keepRecentTokens?: number;
  minKeepMessages?: number;
}): ContextTransform {
  const window = opts.contextWindow;
  const overhead = opts.overheadTokens ?? 0;
  const preservers = opts.preservers ?? [];
  let checkpoint: { summary: Message; coveredCount: number } | null = null;

  return async (input) => {
    const messages = asStored(input);
    const liveTail = messages.slice(checkpoint?.coveredCount ?? 0);
    const base = checkpoint ? [checkpoint.summary, ...liveTail] : liveTail;

    const tokens = estimateContextTokens(base) + overhead;
    if (tokens < window * COMPACT_AT_RATIO) return asPi(base);

    // Only the live tail is split; the standing summary is always re-folded.
    const selected = selectFold(liveTail, pickRecentTail, {
      keepRecentTokens: opts.keepRecentTokens ?? Math.floor(window * KEEP_RECENT_RATIO),
      minKeepMessages: opts.minKeepMessages ?? MIN_KEEP_MESSAGES,
    });
    if (!selected) return asPi(base);

    log.info(`within-turn fold of ${selected.fold.length} messages (${tokens}/${window} tokens)`);
    try {
      const prefix = checkpoint ? [checkpoint.summary] : [];
      const text = await summarizeFold(
        [...prefix, ...selected.fold],
        selected.recent,
        opts.summarize,
        preservers,
      );
      const summary: Message = { role: 'user', content: text, timestamp: Date.now() };
      checkpoint = { summary, coveredCount: messages.length - selected.recent.length };
      return asPi([summary, ...selected.recent]);
    } catch (err) {
      log.warn(`within-turn fold failed, proceeding uncompacted: ${(err as Error).message}`);
      return asPi(base);
    }
  };
}
