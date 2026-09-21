import type { Usage } from '@earendil-works/pi-ai';
import type { SideCallKind } from '@main/conversation/store/conversation';
import type { Db } from '@main/db';
import type { Sandbox } from '../sandbox/types';

/** One model call made beside the turn, and what it cost. */
export type SideCall = {
  kind: SideCallKind;
  usage: Usage;
  /** The call's own model, when it isn't the run's — a pinned subagent's. */
  providerId?: string;
  modelId?: string;
};

/**
 * The turn's own context, closed over by everything built per run: the tools,
 * the nested loops, the side calls. It carries what a turn *is* — where it runs,
 * what it can write to, how it reaches the UI — and nothing about the engine,
 * which is passed to the pieces that need it.
 */
export type RunContext = {
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  workspaceRoot: string;
  /** The system prompt this turn runs under. */
  system: string;
  /** The run's model identity, for the usage ledger. Optional: test contexts
   *  omit it, and a subagent inherits its parent's when not pinned to its own. */
  providerId?: string;
  modelId?: string;
  /**
   * Announce something that belongs beside the conversation rather than in it —
   * a compaction in progress, a subagent's activity. Notices are delivered to
   * the reader and never stored, so nothing that must survive a reload may go
   * out this way.
   */
  notice: (name: string, data: unknown) => void;
  /**
   * Record what a model call made beside the turn spent — a subagent's own
   * loop, for instance. These produce no message of their own, so without this
   * their tokens appear in no ledger at all. Optional: test contexts omit it.
   */
  spend?: (call: SideCall) => void;
  /** Cross-step scratch space; each feature namespaces its own keys. */
  scratch: Map<string, unknown>;
};
