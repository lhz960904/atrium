import type { ModelMessage } from 'ai';

/**
 * A feature's hook for surviving compaction. When its state (a plan, an active
 * skill, …) is about to be folded away, it returns the text to carry forward
 * into the summary, or null when there's nothing to preserve — the kept window
 * already holds it, say. Compaction runs every configured preserver and appends
 * their output; it never needs to know what a feature's state is.
 */
export type CompactionPreserver = (fold: ModelMessage[], recent: ModelMessage[]) => string | null;
