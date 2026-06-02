import type { UIMessage } from 'ai';
import type { AtriumTools } from './tools';

/**
 * Transient UI data parts the server streams via writer.write — delivered to
 * the client's onData, never persisted into messages. `compaction` announces
 * an in-progress cross-turn fold (phase start/done) so the UI shows a live
 * indicator. Within-turn folds aren't surfaced (internal, not persisted).
 */
export type AtriumDataParts = {
  compaction: { phase: 'start' | 'done' };
};

/**
 * Per-assistant-message observability, minted server-side via the stream's
 * messageMetadata callback and persisted alongside parts. `durationMs` drives
 * the "Worked for …" trace header; it's only present once a turn finishes.
 */
export type AtriumMessageMetadata = {
  createdAt?: number;
  durationMs?: number;
  totalTokens?: number;
  /** Prompt tokens at turn end (last step input+output) — compaction's counting base. */
  contextTokens?: number;
  /** Marks the persisted compaction checkpoint pair (summary + its ack). */
  kind?: 'compaction' | 'compaction-ack';
  /** On a 'compaction' summary, the id of the last folded message. */
  coveredThroughId?: string;
};

/**
 * Canonical chat message shape across Atrium (persisted in messages.parts,
 * streamed over /api/chat, rendered by the chat components). The tools generic
 * makes tool parts (name, input, output) strongly typed end to end.
 */
export type AtriumUIMessage = UIMessage<AtriumMessageMetadata, AtriumDataParts, AtriumTools>;
