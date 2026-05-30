import {
  convertToModelMessages,
  generateId,
  type LanguageModel,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { buildSystemPrompt } from './prompts';

export type RunAgentOptions = {
  model: LanguageModel;
  messages: UIMessage[];
  /** Absolute workspace root, surfaced to the model in the system prompt. */
  workspaceRoot: string;
  abortSignal?: AbortSignal;
  /** Tools the model may call; the caller builds them around a sandbox. */
  tools?: ToolSet;
  /** Called once the assistant message is complete, for persistence. */
  onFinish?: (assistant: UIMessage) => void;
};

/**
 * The agent loop. AI SDK's streamText is itself the multi-step ReAct loop:
 * with tools + stopWhen it keeps going model→tool→model until done.
 *
 * Both the model (providers layer resolves + decrypts) and the tools (built
 * around a sandbox) are supplied by the caller, so runAgent stays free of
 * DB / fs / credential concerns. Returns the streaming HTTP Response — the
 * agent's only transport is the chat stream.
 */
export async function runAgent(opts: RunAgentOptions): Promise<Response> {
  const result = streamText({
    model: opts.model,
    system: buildSystemPrompt(opts.workspaceRoot),
    messages: await convertToModelMessages(opts.messages),
    tools: opts.tools,
    stopWhen: stepCountIs(12),
    abortSignal: opts.abortSignal,
  });
  // Drive the stream to completion server-side (no await) so onFinish — and
  // thus persistence — runs even if the client disconnects mid-stream.
  result.consumeStream();
  let startedAt = 0;
  return result.toUIMessageStreamResponse({
    originalMessages: opts.messages,
    // We stream directly from main (no client-assigned id), so the server
    // must mint the assistant message id — otherwise it's empty and every
    // assistant row collides on id, dropping all but the first.
    generateMessageId: generateId,
    // Stamp timing + usage onto the message so the trace header can render
    // "Worked for …"; durationMs is wall clock from first chunk to finish.
    messageMetadata: ({ part }) => {
      if (part.type === 'start') {
        startedAt = Date.now();
        return { createdAt: startedAt };
      }
      if (part.type === 'finish') {
        // Optional-chain usage: if it throws here the whole return is lost and
        // durationMs never lands, so the header falls back to a bare "Worked".
        return { durationMs: Date.now() - startedAt, totalTokens: part.totalUsage?.totalTokens };
      }
      return undefined;
    },
    onFinish: ({ responseMessage }) => opts.onFinish?.(responseMessage),
  });
}
