import type { LanguageModel, ModelMessage } from 'ai';
import { createLogger } from '../../../log';
import type { CompactionPreserver } from '../../compaction/preserver';
import { summarize } from '../../compaction/summarize';
import { countTokensModel } from '../../compaction/tokens';
import { pickRecentWindowModel, type WindowOptions } from '../../compaction/window';
import type { AgentMiddleware, RunContext, StepInfo, StepOverride } from '../types';

const log = createLogger('compaction');

const SUMMARY_PREAMBLE =
  'Earlier conversation was compacted to save context. Summary of what came before:\n\n';

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
  /** Trigger fraction of the window, default 0.8. */
  compactAtRatio?: number;
  /** Recent-window token budget, default 25% of the window. */
  keepRecentTokens?: number;
  /** Floor on kept messages, default 4. */
  minKeepMessages?: number;
  /** Summary model; defaults to the run's model. */
  summaryModel?: LanguageModel;
  /** Feature hooks that carry their state (plan, skills, …) across a fold. */
  preservers?: CompactionPreserver[];
};

function modelIdOf(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

/**
 * Fold a nested loop's own history when it nears the context window, keeping a
 * recent window verbatim. Only the model-bound step view changes — nothing is
 * persisted, because a nested run has no stored history to check point against.
 */
export function compactionMiddleware(options: CompactionOptions): AgentMiddleware {
  const ratio = options.compactAtRatio ?? DEFAULT_COMPACT_AT_RATIO;
  const minKeepMessages = options.minKeepMessages ?? DEFAULT_MIN_KEEP_MESSAGES;
  const preservers = options.preservers ?? [];

  return {
    name: 'compaction',
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
        const carried = preservers.map((p) => p(foldedTail, recent)).filter(isText);
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
