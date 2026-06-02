import type { ModelMessage, UIMessage } from 'ai';

/**
 * A feature's hook for surviving compaction. When its state (a plan, an active
 * skill, …) is about to be folded away, it returns the text to carry forward
 * into the summary, or null when there's nothing to preserve (e.g. the kept
 * window already holds it). Compaction runs every configured preserver and
 * appends their output — it never needs to know what a feature's state is.
 *
 * Two variants because compaction folds UIMessages cross-turn and ModelMessages
 * within-turn; a preserver inspects whichever the current fold is in.
 */
export type CompactionPreserver = {
  fromUI(fold: UIMessage[], recent: UIMessage[]): string | null;
  fromModel(fold: ModelMessage[], recent: ModelMessage[]): string | null;
};
