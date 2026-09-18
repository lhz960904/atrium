/**
 * The vocabulary the chat surface renders. Its shapes began as the AI SDK's,
 * which is no longer a dependency, so what is left is only what the components
 * actually read — the transient data-part channel it also defined is gone,
 * replaced by notices the chat store routes to their own stores.
 */

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

type TextUIPart = { type: 'text'; text: string; state?: 'streaming' | 'done' };

type ReasoningUIPart = {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';
  providerMetadata?: Record<string, unknown>;
};

type FileUIPart = { type: 'file'; url: string; mediaType: string; filename?: string };

type StepStartUIPart = { type: 'step-start' };

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

type UIMessagePart<TOOLS extends Record<string, { input: unknown; output: unknown }>> =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | StepStartUIPart
  | ToolUIPart<TOOLS>
  | DynamicToolUIPart;

export type UIMessage<
  METADATA = unknown,
  TOOLS extends Record<string, { input: unknown; output: unknown }> = Record<
    string,
    { input: unknown; output: unknown }
  >,
> = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: METADATA;
  parts: UIMessagePart<TOOLS>[];
};

// ---------------------------------------------------------------------------
// part predicates and accessors
// ---------------------------------------------------------------------------

export function isStaticToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: `tool-${string}` }> {
  return part.type.startsWith('tool-');
}

function isDynamicToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: 'dynamic-tool' }> {
  return part.type === 'dynamic-tool';
}

export function isToolOrDynamicToolUIPart<P extends { type: string }>(
  part: P,
): part is Extract<P, { type: `tool-${string}` } | { type: 'dynamic-tool' }> {
  return isStaticToolUIPart(part) || isDynamicToolUIPart(part);
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
