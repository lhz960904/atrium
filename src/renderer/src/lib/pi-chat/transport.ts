import type { AtriumUIMessage } from '@shared/chat';
import type { DecideInteraction } from '@shared/interactions';
import type { PermissionMode } from '@shared/permissions';
import type { EventEnvelope } from '@shared/protocol';
import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '../../../../main/api/trpc/router';

/**
 * Everything the chat store needs from the main process, as one port.
 *
 * The store used to speak HTTP to a localhost server, which existed only
 * because the AI SDK's transport needed a fetchable URL. Naming the port
 * instead of the protocol is what lets the store be tested without a transport
 * at all, and what keeps a second caller — an editor speaking ACP, say — from
 * having to pretend to be a browser.
 */

export type RunTarget = {
  threadId: string;
  providerId?: string;
  modelId?: string;
  permissionMode?: PermissionMode;
};

export type StreamHandlers = {
  onData: (envelope: EventEnvelope) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};

/** Detaches this reader. It never stops the run — see chat.events. */
export type Detach = () => void;

export type ChatTransport = {
  send(input: RunTarget & { message: AtriumUIMessage }): Promise<void>;
  decide(input: { threadId: string; interaction: DecideInteraction }): Promise<void>;
  abort(threadId: string): Promise<void>;
  /** Watch the log of the run just started, replaying from `from`. */
  events(input: { threadId: string; from: number }, handlers: StreamHandlers): Detach;
  /** Watch a run already in flight; completes at once when there is none. */
  rejoin(input: { threadId: string; from: number }, handlers: StreamHandlers): Detach;
};

/**
 * The port in tRPC's terms. Two mismatches are bridged here and nowhere else:
 * tRPC types the error as its own, and its output inference turns a field typed
 * `unknown` into an optional one — so the envelope it infers is not quite the
 * one both sides are actually written against.
 */
const observer = (handlers: StreamHandlers) => ({
  onData: (value: unknown) => handlers.onData(value as EventEnvelope),
  onError: (error: unknown) => handlers.onError(error),
  onComplete: handlers.onComplete,
});

/** One client for callers outside React; the provider keeps its own for hooks. */
const client = createTRPCProxyClient<AppRouter>({ links: [ipcLink()] });

export const ipcChatTransport: ChatTransport = {
  send: (input) => {
    const { threadId, providerId, modelId, permissionMode, message } = input;
    if (!providerId || !modelId) throw new Error('No model is selected for this chat.');
    return client.chat.send.mutate({ threadId, providerId, modelId, permissionMode, message });
  },
  decide: (input) => client.chat.decide.mutate(input).then(() => undefined),
  abort: (threadId) => client.chat.abort.mutate({ threadId }).then(() => undefined),
  events: (input, handlers) => client.chat.events.subscribe(input, observer(handlers)).unsubscribe,
  rejoin: (input, handlers) => client.chat.rejoin.subscribe(input, observer(handlers)).unsubscribe,
};
