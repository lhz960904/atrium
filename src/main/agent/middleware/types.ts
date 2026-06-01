import type { ToolName } from '@shared/tools';
import type {
  LanguageModel,
  ModelMessage,
  TextStreamPart,
  Tool,
  ToolSet,
  UIMessage,
  UIMessageStreamWriter,
} from 'ai';
import type { Db } from '../../db';
import type { Sandbox } from '../sandbox/types';

/** The model request a run carries; beforeRun may mutate it before the loop. */
export type AgentRequest = {
  system: string;
  messages: UIMessage[];
  tools: Record<ToolName, Tool>;
};

/** Persists across the whole turn; the runner closes over it into every hook. */
export type RunContext = {
  threadId: string;
  db: Db;
  sandbox: Sandbox;
  workspaceRoot: string;
  request: AgentRequest;
  /** The run's model, reused by middleware (e.g. compaction's summarizer). */
  model: LanguageModel;
  /** Write a UI stream part (transient data events, …); a no-op outside a stream. */
  emit: UIMessageStreamWriter['write'];
  /** Cross-step scratch space; each middleware namespaces its own keys. */
  scratch: Map<string, unknown>;
};

// Step hooks run inside the model loop, downstream of convertToModelMessages —
// they see and override ModelMessages (the wire form), not our UIMessages.
export type StepInfo = { stepNumber: number; messages: ModelMessage[] };

/** What beforeStep returns to override the upcoming model call. */
export type StepOverride = {
  system?: string;
  messages?: ModelMessage[];
  activeTools?: ToolName[];
};

export type StepResultInfo = {
  stepNumber: number;
  finishReason: string;
  text: string;
  toolCalls: unknown[];
  toolResults: unknown[];
  usage?: { totalTokens?: number };
};

export type ToolCallInfo = { name: ToolName; input: unknown; toolCallId: string };

/** beforeToolUse returns this to skip execution and use `result` instead. */
export type ToolShortCircuit = { result: unknown };

export type RunResultInfo = { message: UIMessage };

/** The stream part messageMetadata receives — streamText's fullStream element. */
export type MetadataPart = TextStreamPart<ToolSet>;

type MaybePromise<T> = T | Promise<T>;

export interface AgentMiddleware {
  name: string;

  /** Turn start (once). Setup; may mutate ctx.request. */
  beforeRun?(ctx: RunContext): MaybePromise<void>;

  /** Each step, before the model call. Returned fields override that step. */
  // biome-ignore lint/suspicious/noConfusingVoidType: optional-return hook — may return an override or nothing
  beforeStep?(ctx: RunContext, step: StepInfo): MaybePromise<StepOverride | void>;

  /** Each step, after the model + that step's tools ran. Observe only. */
  afterStep?(ctx: RunContext, step: StepResultInfo): MaybePromise<void>;

  /** Before a tool runs. Return a result to short-circuit (skip execution). */
  // biome-ignore lint/suspicious/noConfusingVoidType: optional-return hook — may short-circuit or nothing
  beforeToolUse?(ctx: RunContext, call: ToolCallInfo): MaybePromise<ToolShortCircuit | void>;

  /** After a tool runs. Return a value to replace the result. */
  afterToolUse?(ctx: RunContext, call: ToolCallInfo, result: unknown): MaybePromise<unknown>;

  /** Turn end (once). Persist, queue memory, release resources. */
  afterRun?(ctx: RunContext, result: RunResultInfo): MaybePromise<void>;

  /** Annotate the UIMessage. Returns merge into one metadata object. */
  messageMetadata?(part: MetadataPart): Record<string, unknown> | undefined;
}
