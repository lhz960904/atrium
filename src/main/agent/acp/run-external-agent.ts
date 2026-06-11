import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { PermissionMode } from '@shared/permissions';
import {
  createUIMessageStream,
  generateId,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { readableError } from '../errors';
import { makeAcpOnPermission } from './acp-permission';
import { ChunkEmitter } from './chunk-emitter';
import type { AcpPermissionBroker } from './permission-broker';
import type { AcpSessionRegistry, AcpSpec } from './registry';

export type RunExternalAgentOptions = {
  registry: AcpSessionRegistry;
  threadId: string;
  /** Which adapter to run (provider id + command/args/cwd). */
  spec: AcpSpec;
  /** Prior ACP session id to resume on a cold start (from persisted binding). */
  resume?: string;
  messages: UIMessage[];
  /** The thread's permission mode; gates whether the agent's asks reach the user. */
  mode: PermissionMode;
  /** Parks the agent's permission requests until the user answers (see broker). */
  broker: AcpPermissionBroker;
  /** Reviewer for auto-review mode; absent → auto-review behaves like default. */
  reviewerModel?: LanguageModel;
  abortSignal?: AbortSignal;
  onFinish: (message: UIMessage) => void;
  /** Persist the (possibly new) ACP session id so the thread can resume later. */
  onSession?: (sessionId: string) => void;
};

/** The text of the most recent user message — the prompt for this turn. */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    return (messages[i].parts ?? [])
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
  }
  return '';
}

const textToContent = (text: string): ContentBlock[] => [{ type: 'text', text }];

/** A session update that renders as visible content (vs. commands/mode notices). */
const isContent = (kind: string): boolean =>
  kind === 'agent_message_chunk' || kind === 'agent_thought_chunk' || kind === 'tool_call';

/**
 * A turn handled by an external CLI agent (Claude Code / Codex / Gemini) over
 * ACP. The agent owns its own tool loop, model, and auth; we relay the prompt
 * and stream its events back as the same UIMessageChunk stream runAgent produces,
 * so server and client treat both turns the same. The session is acquired from
 * the per-thread registry (reused across turns to keep the agent's context) and
 * left alive afterward — the registry owns its lifetime.
 */
export function runExternalAgentTurn(
  opts: RunExternalAgentOptions,
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    originalMessages: opts.messages,
    generateId,
    onError: readableError,
    onFinish: ({ responseMessage }) => opts.onFinish(responseMessage),
    execute: async ({ writer }) => {
      const startedAt = Date.now();
      const emitter = new ChunkEmitter(writer);
      // acquire() throws if the adapter can't start (not installed, etc.); the
      // stream's onError turns that into a readable error in the chat.
      const { session, sessionId } = await opts.registry.acquire(
        opts.threadId,
        opts.spec,
        opts.resume,
      );
      opts.onSession?.(sessionId);
      // On stop/abort: cancel the agent's turn AND settle any parked permission
      // ask as cancelled — the agent is blocked on it and cancel alone doesn't
      // resolve the client-side promise it's waiting behind.
      const onAbort = (): void => {
        void session.cancel();
        opts.broker.cancelThread(opts.threadId);
      };
      opts.abortSignal?.addEventListener('abort', onAbort);
      const onPermission = makeAcpOnPermission({
        threadId: opts.threadId,
        mode: opts.mode,
        broker: opts.broker,
        reviewerModel: opts.reviewerModel,
        abortSignal: opts.abortSignal,
        write: (chunk) => writer.write(chunk),
      });
      // The turn's message opens on the first visible chunk — not before, since
      // an early chunk would flip the turn out of its loading state. The start
      // chunk matters beyond protocol hygiene: createUIMessageStream injects the
      // server-minted messageId into it, which is what binds every consumer
      // (the live client, and each replay after a reload) to the SAME message.
      // Without it each replay minted a fresh client-side id and the turn
      // duplicated on screen. createdAt and durationMs metadata merge into the
      // message so the trace shows "Working… Xs" / "Worked for Xs".
      let started = false;
      try {
        await session.prompt(textToContent(latestUserText(opts.messages)), {
          onUpdate: (u) => {
            if (!started && isContent(u.sessionUpdate)) {
              started = true;
              writer.write({ type: 'start' });
              writer.write({ type: 'message-metadata', messageMetadata: { createdAt: startedAt } });
            }
            emitter.handle(u);
          },
          onPermission,
        });
        emitter.flush();
        writer.write({
          type: 'message-metadata',
          messageMetadata: { durationMs: Date.now() - startedAt },
        });
      } finally {
        opts.abortSignal?.removeEventListener('abort', onAbort);
        // Backstop: if the turn ended any other way (agent died, prompt threw)
        // while an ask was parked, settle it so the entry doesn't leak.
        opts.broker.cancelThread(opts.threadId);
      }
    },
  });
}
