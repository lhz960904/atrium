import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import type { Db } from '../db';
import { resolveModel } from '../providers/resolve';
import { SYSTEM_PROMPT } from './prompts';

export type RunAgentOptions = {
  db: Db;
  providerId: string;
  modelId: string;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
};

/**
 * The agent loop. AI SDK's streamText is itself the multi-step ReAct loop:
 * with tools + stopWhen it keeps going model→tool→model until done. Tools
 * land in 5.d; this version streams plain text only.
 *
 * Returns the streaming HTTP Response (the agent's only transport is the
 * localhost chat stream, per D-4). Annotating Response also avoids leaking
 * the SDK's un-nameable internal `Output` type across the module boundary.
 */
export async function runAgent(opts: RunAgentOptions): Promise<Response> {
  const model = resolveModel(opts.db, opts.providerId, opts.modelId);
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(opts.messages),
    stopWhen: stepCountIs(12),
    abortSignal: opts.abortSignal,
  });
  return result.toUIMessageStreamResponse();
}
