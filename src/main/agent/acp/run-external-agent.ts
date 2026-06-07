import type { ContentBlock } from '@agentclientprotocol/sdk';
import { createUIMessageStream, generateId, type UIMessage, type UIMessageChunk } from 'ai';
import { readableError } from '../errors';
import { ChunkEmitter } from './chunk-emitter';
import type { AcpSessionRegistry, AcpSpec } from './registry';
import type { AcpTurnHandlers } from './session';

export type RunExternalAgentOptions = {
  registry: AcpSessionRegistry;
  threadId: string;
  /** Which adapter to run (provider id + command/args/cwd). */
  spec: AcpSpec;
  /** Prior ACP session id to resume on a cold start (from persisted binding). */
  resume?: string;
  messages: UIMessage[];
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

/** Permission is deferred — always approve for now; a dedicated scheme comes later. */
const approveAll: AcpTurnHandlers['onPermission'] = async (req) => {
  const allow =
    req.options.find((o) => o.kind === 'allow_always') ??
    req.options.find((o) => o.kind === 'allow_once') ??
    req.options[0];
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : { outcome: { outcome: 'cancelled' } };
};

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
      const emitter = new ChunkEmitter(writer);
      // acquire() throws if the adapter can't start (not installed, etc.); the
      // stream's onError turns that into a readable error in the chat.
      const { session, sessionId } = await opts.registry.acquire(
        opts.threadId,
        opts.spec,
        opts.resume,
      );
      opts.onSession?.(sessionId);
      const onAbort = (): void => void session.cancel();
      opts.abortSignal?.addEventListener('abort', onAbort);
      try {
        await session.prompt(textToContent(latestUserText(opts.messages)), {
          onUpdate: (u) => emitter.handle(u),
          onPermission: approveAll,
        });
        emitter.flush();
      } finally {
        opts.abortSignal?.removeEventListener('abort', onAbort);
      }
    },
  });
}
