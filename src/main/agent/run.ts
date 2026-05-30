import {
  convertToModelMessages,
  generateId,
  type LanguageModel,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { SYSTEM_PROMPT } from './prompts';

export type RunAgentOptions = {
  model: LanguageModel;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  /** Called once the assistant message is complete, for persistence. */
  onFinish?: (assistant: UIMessage) => void;
};

/**
 * The agent loop. AI SDK's streamText is itself the multi-step ReAct loop:
 * with tools + stopWhen it keeps going model→tool→model until done. Tools
 * land in 5.d; this version streams plain text only.
 *
 * The model is supplied by the caller (providers layer resolves + decrypts);
 * runAgent stays free of DB/credential concerns. Returns the streaming HTTP
 * Response (the agent's only transport is the localhost chat stream, per D-4).
 */
export async function runAgent(opts: RunAgentOptions): Promise<Response> {
  const result = streamText({
    model: opts.model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(opts.messages),
    stopWhen: stepCountIs(12),
    abortSignal: opts.abortSignal,
  });
  // Drive the stream to completion server-side (no await) so onFinish — and
  // thus persistence — runs even if the client disconnects mid-stream.
  result.consumeStream();
  return result.toUIMessageStreamResponse({
    originalMessages: opts.messages,
    // We stream directly from main (no client-assigned id), so the server
    // must mint the assistant message id — otherwise it's empty and every
    // assistant row collides on id, dropping all but the first.
    generateMessageId: generateId,
    onFinish: ({ responseMessage }) => opts.onFinish?.(responseMessage),
  });
}
