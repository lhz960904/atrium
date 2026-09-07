import type { Db } from '../db';
import type { Sandbox } from './sandbox/types';

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
   * Write a transient UI event. Tools speak in stream chunks (`data-*`, `file`)
   * because that is the vocabulary the renderer's notice router already reads;
   * the run maps them onto the wire.
   */
  emit: (chunk: { type: string; [key: string]: unknown }) => void;
  /** Cross-step scratch space; each feature namespaces its own keys. */
  scratch: Map<string, unknown>;
};
