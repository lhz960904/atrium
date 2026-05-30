import type { UIDataTypes, UIMessage } from 'ai';
import type { AtriumTools } from './tools';

/**
 * Per-assistant-message observability, minted server-side via the stream's
 * messageMetadata callback and persisted alongside parts. `durationMs` drives
 * the "Worked for …" trace header; it's only present once a turn finishes.
 */
export type AtriumMessageMetadata = {
  createdAt?: number;
  durationMs?: number;
  totalTokens?: number;
};

/**
 * Canonical chat message shape across Atrium (persisted in messages.parts,
 * streamed over /api/chat, rendered by the chat components). The tools generic
 * makes tool parts (name, input, output) strongly typed end to end.
 */
export type AtriumUIMessage = UIMessage<AtriumMessageMetadata, UIDataTypes, AtriumTools>;
