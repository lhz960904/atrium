import { Chat } from '@ai-sdk/react';
import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { getQueryKey } from '@trpc/react-query';
import {
  getStaticToolName,
  isStaticToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { useAcpApprovalStore } from '../state/acp-approval-store';
import { useAutoReviewStore } from '../state/auto-review-store';
import { useCompactionStore } from '../state/compaction-store';
import { useImageGenStore } from '../state/image-gen-store';
import { useModelStore } from '../state/model-store';
import { usePermissionStore } from '../state/permission-store';
import { useSubagentStore } from '../state/subagent-store';
import { makeChatTransport } from './chat-transport';
import { queryClient } from './query-client';
import { trpc } from './trpc';

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

/** A cancelled clarification resolves its tool call but must NOT auto-resume —
 *  the user took back the turn and sends again themselves. */
function lastClarifyCancelled(messages: AtriumUIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant') return false;
  return last.parts.some(
    (p) =>
      isStaticToolUIPart(p) &&
      getStaticToolName<AtriumTools>(p) === 'ask_clarification' &&
      p.state === 'output-available' &&
      (p.output as ClarifyResult | undefined)?.cancelled === true,
  );
}

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

/**
 * Drop a thread's cached Chat so its next open re-seeds from the DB (+ resume).
 * Used when a background run (a scheduled task) mutated the thread out-of-band,
 * which the in-memory Chat can't know about. No-op while the Chat is streaming
 * in this client — evicting a live consumer would cancel its stream.
 */
export function dropThreadChat(threadId: string): void {
  const chat = chats.get(threadId);
  if (chat && !isBusy(chat)) chats.delete(threadId);
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
      return {
        threadId,
        providerId: m?.providerId,
        modelId: m?.modelId,
        permissionMode: usePermissionStore.getState().mode,
      };
    }),
    // Two completions resume a turn automatically: a tool call that now has its
    // output (ask_clarification answered, or any settled tool), and an approval
    // request the user just answered — both leave the turn mid-flight, waiting
    // for the model to continue. A cancelled clarification resolves its call too
    // but must NOT resume: it's persisted separately and the user drives next.
    sendAutomaticallyWhen: ({ messages }) =>
      (lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) &&
      !lastClarifyCancelled(messages),
    // Transient compaction events never enter messages; surface them as live
    // per-thread status the chat view reads to show a "compacting…" indicator.
    onData: (part) => {
      if (part.type === 'data-compaction') {
        useCompactionStore.getState().setActive(threadId, part.data.phase === 'start');
      } else if (part.type === 'data-imageGeneration') {
        useImageGenStore.getState().setActive(threadId, part.data.phase === 'start');
      } else if (part.type === 'data-subagent') {
        const store = useSubagentStore.getState();
        const d = part.data;
        if (d.phase === 'start') store.start(d.id);
        else if (d.phase === 'step') store.addTools(d.id, d.tools);
        else store.finish(d.id, d.status);
      } else if (part.type === 'data-permissionRequest') {
        useAcpApprovalStore.getState().push(threadId, part.data);
      } else if (part.type === 'data-permissionResolved') {
        useAcpApprovalStore.getState().remove(threadId, part.data.requestId);
      } else if (part.type === 'data-autoReview') {
        useAutoReviewStore.getState().mark(threadId, part.data.toolCallId, part.data.subject);
      } else if (part.type === 'data-title') {
        // A model-generated title landed and is already in the DB; re-fetch the
        // places that show it (header reads threads.get, sidebar threads.list).
        queryClient.invalidateQueries({
          queryKey: getQueryKey(trpc.threads.get, { id: threadId }, 'query'),
        });
        queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.threads.list) });
      }
    },
  });
  chats.set(threadId, chat);
  evictIdle(threadId);
  return { chat, isNew: true };
}
