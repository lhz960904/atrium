import type { ToolName } from '@shared/tools';
import {
  convertToModelMessages,
  createUIMessageStream,
  generateId,
  type LanguageModel,
  stepCountIs,
  streamText,
  type Tool,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { Db } from '../db';
import { readableError } from './errors';
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
 * chain, not here. The whole run is wrapped in a createUIMessageStream so a
 * writer is available throughout: middleware emits transient UI events (e.g.
 * compaction progress) through ctx.emit, and streamText's own UI stream is
 * merged in. beforeRun runs inside execute (after emit is wired) so it can mutate
 * the request and announce itself before the model call. Returns the raw
 * UIMessage chunk stream; resumable.ts owns its lifetime (drains it to
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
    emit: () => {},
    scratch: new Map(),
  };
  const messageMetadata = composeMessageMetadata(opts.middlewares);

  return createUIMessageStream({
    originalMessages: ctx.request.messages,
    // We stream from main (no client-assigned id), so the server mints the
    // assistant message id — otherwise every assistant row collides on id.
    generateId,
    // Surface the real failure to the client (default masks it). The renderer
    // reads useChat's `error` and shows it instead of silently stalling.
    onError: readableError,
    onFinish: ({ responseMessage }) =>
      runAfterRun(ctx, { message: responseMessage }, opts.middlewares),
    execute: async ({ writer }) => {
      ctx.emit = (event) => writer.write(event);
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
        // Hands the run's RunContext to tool execute (the task tool reads it to
        // spawn a subagent that reuses this run's model / sandbox / db).
        experimental_context: ctx,
      });
      writer.merge(
        result.toUIMessageStream({ messageMetadata: ({ part }) => messageMetadata(part) }),
      );
    },
  });
}
