/**
 * Self-owned copy of the UI message vocabulary the chat surface renders —
 * frozen from the AI SDK part shapes the components already consume, so the
 * renderer carries no SDK dependency. The eventual renderer redesign migrates
 * components onto pi shapes directly and retires this module.
 */

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

export type TextUIPart = { type: 'text'; text: string; state?: 'streaming' | 'done' };

export type ReasoningUIPart = {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';
  providerMetadata?: Record<string, unknown>;
};

export type FileUIPart = { type: 'file'; url: string; mediaType: string; filename?: string };

export type SourceUrlUIPart = {
  type: 'source-url';
  sourceId?: string;
  url: string;
  title?: string;
};

export type SourceDocumentUIPart = {
  type: 'source-document';
  sourceId?: string;
  mediaType?: string;
  title?: string;
  filename?: string;
};

export type StepStartUIPart = { type: 'step-start' };

export type ToolApproval = { id: string; approved?: boolean; reason?: string };

/**
 * The tool part state machine: input streams in, an approval may pause the
 * call, execution ends in a result / error / denial. Field availability per
 * state mirrors what the components read.
 */
type ToolStates =
  | {
      state: 'input-streaming';
      input?: unknown;
      output?: never;
      errorText?: never;
      approval?: never;
      preliminary?: never;
    }
  | {
      state: 'input-available';
      input: unknown;
      output?: never;
      errorText?: never;
      approval?: never;
      preliminary?: never;
    }
  | {
      state: 'approval-requested';
      input: unknown;
      output?: never;
      errorText?: never;
      approval: ToolApproval;
      preliminary?: never;
    }
  | {
      state: 'approval-responded';
      input: unknown;
      output?: never;
      errorText?: never;
      approval: ToolApproval;
      preliminary?: never;
    }
  | {
      state: 'output-available';
      input: unknown;
      output: unknown;
      errorText?: never;
      approval?: ToolApproval;
      preliminary?: boolean;
    }
  | {
      state: 'output-error';
      input?: unknown;
      output?: never;
      errorText: string;
      approval?: ToolApproval;
      preliminary?: never;
    }
  | {
      state: 'output-denied';
      input: unknown;
      output?: never;
      errorText?: never;
      approval: ToolApproval;
      preliminary?: never;
    };

type ValueOf<T> = T[keyof T];

export type ToolUIPart<TOOLS extends Record<string, { input: unknown; output: unknown }>> =
  ValueOf<{
    [NAME in keyof TOOLS & string]: {
      type: `tool-${NAME}`;
      toolCallId: string;
      title?: string;
      providerExecuted?: boolean;
    } & ToolStates;
  }>;

export type DynamicToolUIPart = {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  title?: string;
} & ToolStates;

export type DataUIPart<DATA extends Record<string, unknown>> = ValueOf<{
  [NAME in keyof DATA & string]: { type: `data-${NAME}`; id?: string; data: DATA[NAME] };
}>;

export type UIMessagePart<
  DATA extends Record<string, unknown>,
  TOOLS extends Record<string, { input: unknown; output: unknown }>,
> =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | StepStartUIPart
  | DataUIPart<DATA>
  | ToolUIPart<TOOLS>
  | DynamicToolUIPart;

export type UIMessage<
  METADATA = unknown,
  DATA extends Record<string, unknown> = Record<string, unknown>,
  TOOLS extends Record<string, { input: unknown; output: unknown }> = Record<
    string,
    { input: unknown; output: unknown }
  >,
> = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: METADATA;
  parts: UIMessagePart<DATA, TOOLS>[];
};

// ---------------------------------------------------------------------------
// part predicates and accessors
// ---------------------------------------------------------------------------

export function isStaticToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: `tool-${string}` }> {
  return part.type.startsWith('tool-');
}

/** Alias kept for call sites that used the SDK's older name. */
export const isToolUIPart = isStaticToolUIPart;

export function isDynamicToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: 'dynamic-tool' }> {
  return part.type === 'dynamic-tool';
}

export function isToolOrDynamicToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: `tool-${string}` } | { type: 'dynamic-tool' }> {
  return isStaticToolUIPart(part) || isDynamicToolUIPart(part);
}

export function isDataUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: `data-${string}` }> {
  return part.type.startsWith('data-');
}

export function getStaticToolName<TOOLS extends Record<string, unknown>>(part: {
  type: `tool-${string}`;
}): keyof TOOLS & string {
  return part.type.slice('tool-'.length) as keyof TOOLS & string;
}

/** Tool name of either flavor: static parts encode it in the type, dynamic
 *  (MCP) parts carry it as a field. */
export function getToolName(part: { type: string; toolName?: string }): string {
  return part.type === 'dynamic-tool' ? String(part.toolName) : part.type.slice('tool-'.length);
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 16-char random id in the same alphabet message ids have always used. */
export function generateId(size = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}
