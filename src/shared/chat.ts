import type { UIMessage } from 'ai';

/**
 * Canonical chat message shape across Atrium (persisted in messages.parts,
 * streamed over /api/chat, rendered by the chat components). Aliased so we
 * have one place to attach custom metadata / data-part types later.
 */
export type AtriumUIMessage = UIMessage;
