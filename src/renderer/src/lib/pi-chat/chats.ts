import type { AtriumUIMessage } from '@shared/chat';
import { getQueryKey } from '@trpc/react-query';
import { useAutoReviewStore } from '../../state/auto-review-store';
import { useCompactionStore } from '../../state/compaction-store';
import { useModelStore } from '../../state/model-store';
import { usePermissionStore } from '../../state/permission-store';
import { useSubagentStore } from '../../state/subagent-store';
import { queryClient } from '../query-client';
import { trpc } from '../trpc';
import { PiChat } from './store';

/**
 * Persistent per-thread PiChat instances, same lifecycle contract the old
 * useChat store had: a chat outlives the component that renders it, so
 * switching threads rebinds the same instance and an in-flight stream
 * survives; the map is LRU-bounded and eviction is lossless (history is in
 * the DB, a live run is rejoined via the event-log replay).
 */
const MAX_CHATS = 16;

const chats = new Map<string, PiChat>();

function evictIdle(keep: string): void {
  if (chats.size <= MAX_CHATS) return;
  for (const [id, chat] of chats) {
    if (chats.size <= MAX_CHATS) break;
    if (id === keep || chat.isBusy) continue;
    chats.delete(id);
  }
}

/** Drop a thread's cached chat so its next open re-seeds from the DB — used
 *  when a background run mutated the thread out-of-band. No-op mid-stream. */
export function dropThreadChat(threadId: string): void {
  const chat = chats.get(threadId);
  if (chat && !chat.isBusy) chats.delete(threadId);
}

/** Transient side-channel events, routed to the same stores onData once fed. */
function routeNotice(threadId: string, name: string, payload: unknown): void {
  const data = (payload as { data?: unknown } | undefined)?.data as never;
  if (name === 'compaction') {
    useCompactionStore
      .getState()
      .setActive(threadId, (data as { phase?: string })?.phase === 'start');
  } else if (name === 'subagent') {
    const store = useSubagentStore.getState();
    const d = data as { phase: string; id: string; tools?: string[]; status?: string };
    if (d.phase === 'start') store.start(d.id);
    else if (d.phase === 'step') store.addTools(d.id, d.tools as never);
    else store.finish(d.id, d.status as never);
  } else if (name === 'autoReview') {
    const d = data as { toolCallId: string; subject: string };
    useAutoReviewStore.getState().mark(threadId, d.toolCallId, d.subject);
  } else if (name === 'title') {
    // A model-generated title landed and is already in the DB; re-fetch the
    // places that show it (header reads threads.get, sidebar threads.list).
    queryClient.invalidateQueries({
      queryKey: getQueryKey(trpc.threads.get, { id: threadId }, 'query'),
    });
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.threads.list) });
  }
}

export function getThreadChat(
  threadId: string,
  seed: { messages: AtriumUIMessage[]; baseUrl: string; token: string },
): { chat: PiChat; isNew: boolean } {
  const existing = chats.get(threadId);
  if (existing) {
    // Re-insert to mark most-recently-used.
    chats.delete(threadId);
    chats.set(threadId, existing);
    return { chat: existing, isNew: false };
  }

  const chat = new PiChat({
    threadId,
    baseUrl: seed.baseUrl,
    token: seed.token,
    messages: seed.messages,
    // Read this thread's own model per send, so a switch in one thread never
    // leaks into another's turn or resume.
    getExtras: () => {
      const m = useModelStore.getState().byThread[threadId];
      return {
        threadId,
        providerId: m?.providerId,
        modelId: m?.modelId,
        permissionMode: usePermissionStore.getState().mode,
      };
    },
    onNotice: (name, payload) => routeNotice(threadId, name, payload),
  });
  chats.set(threadId, chat);
  evictIdle(threadId);
  return { chat, isNew: true };
}
