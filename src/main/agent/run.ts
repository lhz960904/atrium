import type { PermissionMode } from '@shared/permissions';
import {
  convertToModelMessages,
  createUIMessageStream,
  generateId,
  type LanguageModel,
  smoothStream,
  stepCountIs,
  streamText,
  type Tool,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import type { Db } from '../db';
import { MODEL_CALL_MAX_RETRIES, readableError } from './errors';
import {
  type AgentMiddleware,
  composeBeforeStep,
  composeMessageMetadata,
  type RunContext,
  runAfterRun,
  runBeforeRun,
} from './middleware';
import { readSoul } from './profile/paths';
import { stampCacheBreakpoints, usesAnthropicPromptCache } from './prompt-cache';
import { buildSystemPrompt } from './prompts';
import type { Sandbox } from './sandbox/types';

export type RunAgentOptions = {
  model: LanguageModel;
  /** The model's identity (provider + id), recorded in the usage ledger. */
  providerId?: string;
  modelId?: string;
  messages: UIMessage[];
  /** Absolute workspace root, surfaced to the model in the system prompt. */
  workspaceRoot: string;
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  tools: Record<string, Tool>;
  middlewares: AgentMiddleware[];
  /** Active permission mode, surfaced in the system prompt so the model knows how approvals behave. */
  permissionMode: PermissionMode;
  abortSignal?: AbortSignal;
  /** Fires once when the turn settles (finished or aborted) — e.g. to collapse UI the run left on screen. */
  onSettled?: () => void;
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
  const soul = await readSoul();
  const ctx: RunContext = {
    threadId: opts.threadId,
    db: opts.db,
    sandbox: opts.sandbox,
    workspaceRoot: opts.workspaceRoot,
    request: {
      system: buildSystemPrompt(opts.workspaceRoot, {
        soul,
        platform: process.platform,
        mode: opts.permissionMode,
      }),
      messages: opts.messages,
      tools: opts.tools,
    },
    model: opts.model,
    providerId: opts.providerId,
    modelId: opts.modelId,
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
    onFinish: async ({ responseMessage, isAborted }) => {
      try {
        await runAfterRun(ctx, { message: responseMessage, aborted: isAborted }, opts.middlewares);
      } finally {
        opts.onSettled?.();
      }
    },
    execute: async ({ writer }) => {
      ctx.emit = (event) => writer.write(event);
      await runBeforeRun(ctx, opts.middlewares);

      const beforeStep = composeBeforeStep(ctx, opts.middlewares);
      const stampCache = usesAnthropicPromptCache(opts.providerId);
      const result = streamText({
        model: opts.model,
        system: ctx.request.system,
        // Passing tools routes historical tool outputs through each tool's
        // toModelOutput — without it, an MCP image result in history would be
        // JSON-stringified, sending raw base64 as prompt text.
        messages: await convertToModelMessages(ctx.request.messages, {
          tools: ctx.request.tools,
        }),
        tools: ctx.request.tools,
        // Complex coding tasks routinely exceed a dozen steps; within-turn
        // compaction (beforeStep) keeps the loop from overflowing the window.
        stopWhen: stepCountIs(100),
        maxRetries: MODEL_CALL_MAX_RETRIES,
        // Cache stamping happens after the middleware chain, not inside it:
        // breakpoints are wire metadata that must land on the final per-step
        // message view, whatever compaction or other overrides produced.
        prepareStep: async ({ stepNumber, messages }) => {
          const override = await beforeStep({ stepNumber, messages });
          if (!stampCache) return override;
          return { ...override, messages: stampCacheBreakpoints(override.messages ?? messages) };
        },
        abortSignal: opts.abortSignal,
        experimental_transform: smoothStream({ chunking: 'word', delayInMs: 12 }),
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
