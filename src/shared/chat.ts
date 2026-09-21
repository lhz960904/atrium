import type { AtriumTools, ToolName } from './tools';
import type { UIMessage } from './ui-message';

/** One tool call a subagent made, bubbled up live for its card's activity list
 *  (shown as a static "verb + target" line; no output/expansion). */
export type SubagentActivityTool = { id: string; name: ToolName; input: unknown };

/**
 * Per-assistant-message observability, minted server-side via the stream's
 * messageMetadata callback and persisted alongside parts. `durationMs` drives
 * the "Worked for …" trace header; it's only present once a turn finishes.
 */
export type AtriumMessageMetadata = {
  createdAt?: number;
  durationMs?: number;
  /** The model that produced this turn — fixed within a turn, but can change
   *  between turns when the user switches. Names the context window's
   *  denominator, and which model a turn's usage should be attributed to. */
  providerId?: string;
  modelId?: string;
  totalTokens?: number;
  /** Turn-total input tokens, not counting the cached ones below. */
  inputTokens?: number;
  /** Turn-total output tokens. */
  outputTokens?: number;
  /** Cached input tokens read this turn (the 0.1× cheap ones) — cache-hit signal. */
  cacheReadTokens?: number;
  /** Cached input tokens written this turn (the 1.25× cache-creation ones). */
  cacheCreationTokens?: number;
  /** Prompt tokens at turn end (last step input+output) — compaction's counting base. */
  contextTokens?: number;
  /** What the turn cost in USD, as the provider priced it — never recomputed
   *  here from rates, which is how a displayed figure and a billed one drift. */
  cost?: { input: number; output: number; cache: number; total: number };
  /** Marks a fold's divider, which is shown in place of the messages it covers. */
  kind?: 'compaction';
};

/**
 * Canonical chat message shape across Atrium (persisted in messages.parts,
 * streamed over /api/chat, rendered by the chat components). The tools generic
 * makes tool parts (name, input, output) strongly typed end to end.
 */
export type AtriumUIMessage = UIMessage<AtriumMessageMetadata, AtriumTools>;
