import {
  convertToModelMessages,
  generateId,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import type { Db } from '../../../db';
import type { Logger } from '../../../log';
import type { CompactionPreserver } from '../../compaction/preserver';
import { summarize } from '../../compaction/summarize';
import { countTokensModel, countTokens as defaultCountTokens } from '../../compaction/tokens';
import {
  findLatestCheckpoint,
  pickRecentWindow,
  pickRecentWindowModel,
  type WindowOptions,
} from '../../compaction/window';
import type { AgentMiddleware, RunContext, StepInfo, StepOverride } from '../types';
import type { PersistFn } from './persistence';

const SUMMARY_PREAMBLE =
  'Earlier conversation was compacted to save context. Summary of what came before:\n\n';
const ACK_TEXT = 'Understood — I have the summary above and will continue from here.';

/** Token-budgeted split of a region into [fold, recent]; null when nothing to fold. */
function selectFold<T>(
  region: T[],
  pick: (m: T[], o: WindowOptions) => T[],
  keepRecentTokens: number,
  minKeepMessages: number,
): { fold: T[]; recent: T[] } | null {
  const recent = pick(region, { keepRecentTokens, minKeepMessages });
  const fold = region.slice(0, region.length - recent.length);
  return fold.length === 0 ? null : { fold, recent };
}

/** Summarize a fold (timeout-guarded), appending any preserver text carried across it. */
async function summarizeFold(
  fold: ModelMessage[],
  model: LanguageModel,
  carried: string[],
): Promise<string> {
  const summaryText = await summarize(fold, model, {
    abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  });
  return [SUMMARY_PREAMBLE + summaryText, ...carried].join('\n\n');
}

const isText = (t: string | null): t is string => t !== null;

/**
 * Summarize a fold into the persisted checkpoint pair (summary `user` message +
 * its ack), carrying preserver state across it. The shared core of both the
 * cross-turn middleware fold and the on-demand compactThread — each caller owns
 * its own fold selection, threshold / persistence / emit around this.
 */
async function summarizeToCheckpoint(
  fold: UIMessage[],
  recent: UIMessage[],
  model: LanguageModel,
  preservers: CompactionPreserver[],
): Promise<{ summaryMsg: UIMessage; ackMsg: UIMessage }> {
  const carried = preservers.map((p) => p.fromUI(fold, recent)).filter(isText);
  const text = await summarizeFold(await convertToModelMessages(fold), model, carried);
  const summaryMsg: UIMessage = {
    id: generateId(),
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: { kind: 'compaction', coveredThroughId: fold[fold.length - 1].id },
  };
  const ackMsg: UIMessage = {
    id: generateId(),
    role: 'assistant',
    parts: [{ type: 'text', text: ACK_TEXT }],
    metadata: { kind: 'compaction-ack' },
  };
  return { summaryMsg, ackMsg };
}

const DEFAULT_COMPACT_AT_RATIO = 0.8;
const DEFAULT_KEEP_RECENT_RATIO = 0.25;
const DEFAULT_MIN_KEEP_MESSAGES = 4;
// Compaction is an optimization, never load-bearing: if the summary call hangs
// or errors, we abandon it and run the turn on the un-compacted messages.
// Generous because cross-border access to a hosted model can be slow.
const SUMMARY_TIMEOUT_MS = 60_000;

const TURN_CHECKPOINT_KEY = 'compaction:turn';

// Within-turn checkpoint, transient in scratch (dies at turn end). `summary`
// is the folded prefix as ModelMessages; `coveredCount` is how many of the
// step's raw messages it stands in for, so each step deterministically rebuilds
// [summary, ...live tail] and the prefix stays byte-stable for the prefix cache.
type TurnCheckpoint = { summary: ModelMessage[]; coveredCount: number };

export type CompactionOptions = {
  /** Context window per model id; see agent/models/catalog. */
  maxContextTokens: (modelId: string) => number;
  /** Durably record the checkpoint pair (the assembly site supplies persistMessage). */
  persist: PersistFn;
  /** Trigger fraction of the window, default 0.8. */
  compactAtRatio?: number;
  /** Recent-window token budget, default 25% of the window. */
  keepRecentTokens?: number;
  /** Floor on kept messages, default 4. */
  minKeepMessages?: number;
  /** Summary model; defaults to the run's model. */
  summaryModel?: LanguageModel;
  /** Token counter; defaults to the hybrid estimate. */
  countTokens?: (messages: UIMessage[]) => number;
  /** Feature hooks that carry their state (plan, skills, …) across a fold. */
  preservers?: CompactionPreserver[];
  /** Scoped logger; defaults to console (so unit tests don't pull in electron-log). */
  log?: Logger;
};

function modelIdOf(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

function kindOf(msg: UIMessage): string | undefined {
  return (msg.metadata as { kind?: string } | undefined)?.kind;
}

/**
 * Collapse the history at its latest persisted checkpoint. Reconstructs by id,
 * not by position: a checkpoint is written with the current timestamp so it
 * always sorts newest and can't sit between the folded region and the kept
 * tail. We instead locate the last folded message via `coveredThroughId`, keep
 * everything after it, and prepend the checkpoint pair — order-independent.
 */
export function applyCheckpoint(messages: UIMessage[]): UIMessage[] {
  const cp = findLatestCheckpoint(messages);
  if (!cp) return messages;
  const coveredThroughId = (cp.message.metadata as { coveredThroughId?: string }).coveredThroughId;
  const coveredIdx = messages.findIndex((m) => m.id === coveredThroughId);
  if (coveredIdx < 0) return messages.slice(cp.index);

  let ack: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (kindOf(messages[i]) === 'compaction-ack') {
      ack = messages[i];
      break;
    }
  }
  const after = messages.slice(coveredIdx + 1).filter((m) => {
    const kind = kindOf(m);
    return kind !== 'compaction' && kind !== 'compaction-ack';
  });
  return ack ? [cp.message, ack, ...after] : [cp.message, ...after];
}

/**
 * Summarize old history when it nears the context window, keeping a recent
 * window verbatim. Cross-turn path: runs once per turn in beforeRun, persists
 * the summary as a checkpoint pair so later turns reuse it instead of
 * re-summarizing. Only mutates the model-bound message copy — DB/UI history
 * stays whole (the folded messages remain in the DB).
 */
export function compactionMiddleware(options: CompactionOptions): AgentMiddleware {
  const count = options.countTokens ?? defaultCountTokens;
  const ratio = options.compactAtRatio ?? DEFAULT_COMPACT_AT_RATIO;
  const minKeepMessages = options.minKeepMessages ?? DEFAULT_MIN_KEEP_MESSAGES;
  const preservers = options.preservers ?? [];
  const log = options.log ?? console;

  return {
    name: 'compaction',
    async beforeRun(ctx: RunContext): Promise<void> {
      // Always fold at the latest checkpoint, even under threshold — that reuse
      // is the whole point of persisting it.
      const base = applyCheckpoint(ctx.request.messages);
      ctx.request.messages = base;

      const window = options.maxContextTokens(modelIdOf(ctx.model));
      const tokens = count(base);
      if (tokens < window * ratio) return;

      const keepRecentTokens =
        options.keepRecentTokens ?? Math.floor(window * DEFAULT_KEEP_RECENT_RATIO);
      const selected = selectFold(base, pickRecentWindow, keepRecentTokens, minKeepMessages);
      if (!selected) return;
      const { fold, recent } = selected;

      log.info(`cross-turn fold of ${fold.length} messages (${tokens}/${window} tokens)`);
      ctx.emit({ type: 'data-compaction', data: { phase: 'start' }, transient: true });
      try {
        const { summaryMsg, ackMsg } = await summarizeToCheckpoint(
          fold,
          recent,
          options.summaryModel ?? ctx.model,
          preservers,
        );
        options.persist(ctx.db, ctx.threadId, summaryMsg);
        options.persist(ctx.db, ctx.threadId, ackMsg);
        ctx.request.messages = [summaryMsg, ackMsg, ...recent];
      } catch (err) {
        // Never let a failed summary dead-end the turn — run uncompacted.
        log.warn(`cross-turn fold failed, proceeding uncompacted: ${(err as Error).message}`);
        ctx.request.messages = base;
      } finally {
        ctx.emit({ type: 'data-compaction', data: { phase: 'done' }, transient: true });
      }
    },

    // Within-turn: a single tool loop can balloon past the window before the
    // turn ends. Each step rebuilds [summary, ...live tail] from the scratch
    // checkpoint (deterministic, so the cached prefix holds), re-summarizing
    // only when the tail itself grows past the threshold. Transient — nothing
    // is persisted; the real assistant message is assembled from the full
    // responseMessages, untouched. Injects one user summary (no ack): the
    // recent tail starts on an assistant tool-call, so user→assistant alternates.
    async beforeStep(ctx: RunContext, { messages }: StepInfo): Promise<StepOverride | undefined> {
      const window = options.maxContextTokens(modelIdOf(ctx.model));
      const cp = ctx.scratch.get(TURN_CHECKPOINT_KEY) as TurnCheckpoint | undefined;
      const summaryPrefix = cp?.summary ?? [];
      const liveTail = messages.slice(cp?.coveredCount ?? 0);
      const base = [...summaryPrefix, ...liveTail];

      const tokens = countTokensModel(base);
      if (tokens < window * ratio) {
        return cp ? { messages: base } : undefined;
      }

      const keepRecentTokens =
        options.keepRecentTokens ?? Math.floor(window * DEFAULT_KEEP_RECENT_RATIO);
      // Split only the live tail — the prior summary prefix is always re-folded.
      const selected = selectFold(
        liveTail,
        pickRecentWindowModel,
        keepRecentTokens,
        minKeepMessages,
      );
      if (!selected) return cp ? { messages: base } : undefined;
      const { fold: foldedTail, recent } = selected;

      // Within-turn folds are internal and not persisted — not surfaced in the UI
      // (no emit), matching Codex: compaction shows only at the turn boundary.
      // It is logged, though, since there's no other trace to debug from.
      log.info(`within-turn fold of ${foldedTail.length} messages (${tokens}/${window} tokens)`);
      try {
        const carried = preservers.map((p) => p.fromModel(foldedTail, recent)).filter(isText);
        const content = await summarizeFold(
          [...summaryPrefix, ...foldedTail],
          options.summaryModel ?? ctx.model,
          carried,
        );
        const summaryMsg: ModelMessage = { role: 'user', content };
        ctx.scratch.set(TURN_CHECKPOINT_KEY, {
          summary: [summaryMsg],
          coveredCount: messages.length - recent.length,
        } satisfies TurnCheckpoint);
        return { messages: [summaryMsg, ...recent] };
      } catch (err) {
        // Failed summary: run this step on the existing (un-refolded) view.
        log.warn(`within-turn fold failed, proceeding uncompacted: ${(err as Error).message}`);
        return cp ? { messages: base } : undefined;
      }
    },
  };
}

export type CompactThreadOptions = {
  db: Db;
  threadId: string;
  /** The thread's full history (from the DB). */
  messages: UIMessage[];
  model: LanguageModel;
  persist: PersistFn;
  preservers?: CompactionPreserver[];
  /** Recent-window token budget; defaults to 0 (keep only the message floor). */
  keepRecentTokens?: number;
  minKeepMessages?: number;
  log?: Logger;
};

/**
 * Force-compact a thread now, ignoring the auto-trigger threshold — the path
 * behind a user-invoked `/compact`. Folds everything before the recent window
 * into a summary checkpoint and persists the pair, exactly like beforeRun's
 * cross-turn fold but on demand. Returns false when there's nothing to fold
 * (already minimal). Carries preserver state (plan, active skill) across.
 */
export async function compactThread(opts: CompactThreadOptions): Promise<boolean> {
  const log = opts.log ?? console;
  const base = applyCheckpoint(opts.messages);
  // Force-compact is aggressive on purpose: unlike the automatic path (which
  // keeps ~25% of the window so a short chat folds nothing), the user asked to
  // compact now, so keep only the recent floor and fold everything before it.
  const keepRecentTokens = opts.keepRecentTokens ?? 0;
  const minKeepMessages = opts.minKeepMessages ?? DEFAULT_MIN_KEEP_MESSAGES;

  const selected = selectFold(base, pickRecentWindow, keepRecentTokens, minKeepMessages);
  if (!selected) return false;
  const { fold, recent } = selected;

  const { summaryMsg, ackMsg } = await summarizeToCheckpoint(
    fold,
    recent,
    opts.model,
    opts.preservers ?? [],
  );
  opts.persist(opts.db, opts.threadId, summaryMsg);
  opts.persist(opts.db, opts.threadId, ackMsg);
  log.info(`forced compaction folded ${fold.length} of ${base.length} messages`);
  return true;
}
