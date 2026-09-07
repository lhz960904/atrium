/**
 * Frozen copy of pi's message/content vocabulary (pi-ai 0.84.2), verified
 * field-by-field against the published .d.ts. Never import pi here: persisted
 * rows and the wire protocol must outlive pi 0.x breaking releases —
 * converters at the edges absorb any drift.
 *
 * Deliberate deviations from pi:
 * - AssistantMessage.content is widened from (TextContent | ThinkingContent |
 *   ToolCall)[] to Content[] so unknown part types survive round-trips;
 * - AssistantMessage drops `diagnostics` and `deferred` (engine-runtime
 *   bookkeeping, not persisted);
 * - ToolCall.arguments is Record<string, unknown> instead of pi's
 *   Record<string, any>.
 *
 * Forward-compat rule for every consumer: ignore unknown part types when
 * rendering, preserve them verbatim on write — never switch-exhaust and drop.
 */

export type TextContent = {
  type: 'text';
  text: string;
  textSignature?: string;
};

export type ThinkingContent = {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

export type ImageContent = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ToolCall = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
  /** OpenAI Responses namespace for calls to dynamically loaded or namespaced tools. */
  namespace?: string;
};

export type KnownContent = TextContent | ThinkingContent | ImageContent | ToolCall;

/** Unknown types must survive read/write round-trips untouched. */
export type Content = KnownContent | { type: string; [key: string]: unknown };

export type StopReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'deferred'
  | 'aborted'
  | 'error'
  | 'pending';

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Subset of cacheWrite written with 1h retention; only Anthropic reports this split. */
  cacheWrite1h?: number;
  /** Reasoning/thinking tokens when reported; already included in `output`. */
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

export type UserMessage = {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
};

export type AssistantMessage = {
  role: 'assistant';
  content: Content[];
  api: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  rawStopReason?: string;
  /** Provider indication that the model explicitly ended its turn; debugging only. */
  endTurn?: boolean;
  timestamp: number;
};

export type ToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  /** Arbitrary structured details for logs or UI rendering (tool cards). */
  details?: unknown;
  /** Usage from the tool execution itself; not part of main LLM context accounting. */
  usage?: Usage;
  /** Tools that became available after this result. */
  addedToolNames?: string[];
  isError: boolean;
  timestamp: number;
};

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
