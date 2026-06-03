import type { UIMessage } from 'ai';
import type { AtriumTools, ToolName } from './tools';

/** One tool call a subagent made, bubbled up live for its card's activity list
 *  (shown as a static "verb + target" line; no output/expansion). */
export type SubagentActivityTool = { id: string; name: ToolName; input: unknown };

/**
 * Transient UI data parts the server streams via writer.write — delivered to
 * the client's onData, never persisted into messages. `compaction` announces
 * an in-progress cross-turn fold (phase start/done) so the UI shows a live
 * indicator. Within-turn folds aren't surfaced (internal, not persisted).
 * `subagent` bubbles a delegated subagent's activity (keyed by the task tool's
 * call id) so its card can show a live nested trace; never persisted, so a
 * reloaded card shows just the result.
 */
export type AtriumDataParts = {
  compaction: { phase: 'start' | 'done' };
  subagent:
    | { id: string; phase: 'start' }
    | { id: string; phase: 'step'; tools: SubagentActivityTool[] }
    | { id: string; phase: 'done'; status: 'done' | 'failed' };
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
