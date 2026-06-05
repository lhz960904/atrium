import { Chat } from '@ai-sdk/react';
import type { AtriumUIMessage } from '@shared/chat';
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useCompactionStore } from '../state/compaction-store';
import { useModelStore } from '../state/model-store';
import { useSubagentStore } from '../state/subagent-store';
import { makeChatTransport } from './chat-transport';

/**
 * Persistent per-thread Chat instances. A Chat outlives the React component
 * that renders it, so switching threads (which unmounts/remounts the chat view)
 * rebinds the same Chat instead of reseeding from the DB — the in-memory
 * messages, including an in-flight streaming turn, survive the switch and the
 * underlying fetch is never aborted (useChat only unsubscribes on unmount).
 *
 * The map is bounded by an LRU cap so opening many threads can't grow memory
 * without limit. Eviction is lossless: history lives in the DB and an in-flight
 * run lives in the main-process registry (rejoined via resume), so a dropped
 * Chat is rebuilt on next open. A window reload wipes the map entirely and
 * falls back to the same DB-seed + reconnect path.
 */
const MAX_CHATS = 16;

const chats = new Map<string, Chat<AtriumUIMessage>>();

function isBusy(chat: Chat<AtriumUIMessage>): boolean {
  return chat.status === 'submitted' || chat.status === 'streaming';
}

/**
 * Trim the map back to the cap. Map keeps insertion order, so the first entries
 * are the least-recently-used. Never drop the just-touched thread or one that's
 * still streaming — evicting a live Chat would cancel its stream consumer.
 */
function evictIdle(keep: string): void {
  if (chats.size <= MAX_CHATS) return;
  for (const [id, chat] of chats) {
    if (chats.size <= MAX_CHATS) break;
    if (id === keep || isBusy(chat)) continue;
    chats.delete(id);
  }
}

export function getThreadChat(
  threadId: string,
  seed: { messages: AtriumUIMessage[]; baseUrl: string; token: string },
): { chat: Chat<AtriumUIMessage>; isNew: boolean } {
  const existing = chats.get(threadId);
  if (existing) {
    // Re-insert to mark most-recently-used.
    chats.delete(threadId);
    chats.set(threadId, existing);
    return { chat: existing, isNew: false };
  }

  const chat = new Chat<AtriumUIMessage>({
    id: threadId,
    messages: seed.messages,
    // threadId is fixed per Chat; the model is read live from the store so a
    // mid-session model switch applies to the next send without rebuilding.
    transport: makeChatTransport(seed.baseUrl, seed.token, () => {
      const m = useModelStore.getState().selected;
      return { threadId, providerId: m?.providerId, modelId: m?.modelId };
    }),
    // ask_clarification is a client-side tool with no server execute: the turn
    // ends with its call unanswered. Once the user fills the answer in (via
    // addToolOutput), this resubmits the message so the model continues. Normal
    // turns end on text, not a complete tool call, so they don't re-fire.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Transient compaction events never enter messages; surface them as live
    // per-thread status the chat view reads to show a "compacting…" indicator.
    onData: (part) => {
      if (part.type === 'data-compaction') {
        useCompactionStore.getState().setActive(threadId, part.data.phase === 'start');
      } else if (part.type === 'data-subagent') {
        const store = useSubagentStore.getState();
        const d = part.data;
        if (d.phase === 'start') store.start(d.id);
        else if (d.phase === 'step') store.addTools(d.id, d.tools);
        else store.finish(d.id, d.status);
      }
    },
  });
  chats.set(threadId, chat);
  evictIdle(threadId);
  return { chat, isNew: true };
}
