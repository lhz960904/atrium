import { convertToModelMessages, generateId, type LanguageModel, type UIMessage } from 'ai';
import { summarize } from '../../compaction/summarize';
import { countTokens as defaultCountTokens } from '../../compaction/tokens';
import { findLatestCheckpoint, pickRecentWindow } from '../../compaction/window';
import type { AgentMiddleware, RunContext } from '../types';
import type { PersistFn } from './persistence';

const SUMMARY_PREAMBLE =
  'Earlier conversation was compacted to save context. Summary of what came before:\n\n';
const ACK_TEXT = 'Understood — I have the summary above and will continue from here.';

const DEFAULT_COMPACT_AT_RATIO = 0.8;
const DEFAULT_KEEP_RECENT_RATIO = 0.25;
const DEFAULT_MIN_KEEP_MESSAGES = 4;

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

  return {
    name: 'compaction',
    async beforeRun(ctx: RunContext): Promise<void> {
      // Always fold at the latest checkpoint, even under threshold — that reuse
      // is the whole point of persisting it.
      const base = applyCheckpoint(ctx.request.messages);
      ctx.request.messages = base;

      const window = options.maxContextTokens(modelIdOf(ctx.model));
      if (count(base) < window * ratio) return;

      const keepRecentTokens =
        options.keepRecentTokens ?? Math.floor(window * DEFAULT_KEEP_RECENT_RATIO);
      const recent = pickRecentWindow(base, { keepRecentTokens, minKeepMessages });
      const fold = base.slice(0, base.length - recent.length);
      if (fold.length === 0) return;

      const summaryText = await summarize(
        await convertToModelMessages(fold),
        options.summaryModel ?? ctx.model,
      );

      const summaryMsg: UIMessage = {
        id: generateId(),
        role: 'user',
        parts: [{ type: 'text', text: SUMMARY_PREAMBLE + summaryText }],
        metadata: { kind: 'compaction', coveredThroughId: fold[fold.length - 1].id },
      };
      const ackMsg: UIMessage = {
        id: generateId(),
        role: 'assistant',
        parts: [{ type: 'text', text: ACK_TEXT }],
        metadata: { kind: 'compaction-ack' },
      };
      options.persist(ctx.db, ctx.threadId, summaryMsg);
      options.persist(ctx.db, ctx.threadId, ackMsg);
      ctx.request.messages = [summaryMsg, ackMsg, ...recent];
    },
  };
}
