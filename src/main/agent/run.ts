import type { ToolName } from '@shared/tools';
import {
  convertToModelMessages,
  generateId,
  type LanguageModel,
  stepCountIs,
  streamText,
  type Tool,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { Db } from '../db';
import {
  type AgentMiddleware,
  composeBeforeStep,
  composeMessageMetadata,
  type RunContext,
  runAfterRun,
  runBeforeRun,
} from './middleware';
import { buildSystemPrompt } from './prompts';
import type { Sandbox } from './sandbox/types';

export type RunAgentOptions = {
  model: LanguageModel;
  messages: UIMessage[];
  /** Absolute workspace root, surfaced to the model in the system prompt. */
  workspaceRoot: string;
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  tools: Record<ToolName, Tool>;
  middlewares: AgentMiddleware[];
  abortSignal?: AbortSignal;
};

/**
 * The agent loop. AI SDK's streamText is itself the multi-step ReAct loop:
 * with tools + stopWhen it keeps going model→tool→model until done.
 *
 * Cross-cutting concerns (persistence, metadata, …) live in the middleware
 * chain, not here: this assembles the RunContext, runs beforeRun, then folds
 * the chain into streamText's lifecycle (messageMetadata, onFinish). Returns
 * the raw UIMessage chunk stream; resumable.ts owns its lifetime (drains it to
 * completion + multicasts), so a client disconnect can't cancel generation.
 */
export async function runAgent(opts: RunAgentOptions): Promise<ReadableStream<UIMessageChunk>> {
  const ctx: RunContext = {
    threadId: opts.threadId,
    db: opts.db,
    sandbox: opts.sandbox,
    workspaceRoot: opts.workspaceRoot,
    request: {
      system: buildSystemPrompt(opts.workspaceRoot),
      messages: opts.messages,
      tools: opts.tools,
    },
    model: opts.model,
    scratch: new Map(),
  };
  await runBeforeRun(ctx, opts.middlewares);

  const beforeStep = composeBeforeStep(ctx, opts.middlewares);
  const result = streamText({
    model: opts.model,
    system: ctx.request.system,
    messages: await convertToModelMessages(ctx.request.messages),
    tools: ctx.request.tools,
    // Complex coding tasks routinely exceed a dozen steps; within-turn
    // compaction (beforeStep) keeps the loop from overflowing the window.
    stopWhen: stepCountIs(100),
    prepareStep: ({ stepNumber, messages }) => beforeStep({ stepNumber, messages }),
    abortSignal: opts.abortSignal,
  });

  const messageMetadata = composeMessageMetadata(opts.middlewares);
  return result.toUIMessageStream({
    originalMessages: ctx.request.messages,
    // We stream from main (no client-assigned id), so the server must mint the
    // assistant message id — otherwise it's empty and every assistant row
    // collides on id, dropping all but the first.
    generateMessageId: generateId,
    messageMetadata: ({ part }) => messageMetadata(part),
    onFinish: ({ responseMessage }) =>
      runAfterRun(ctx, { message: responseMessage }, opts.middlewares),
  });
}
