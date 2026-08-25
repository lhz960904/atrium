import type { ImageContent, Message, StopReason, TextContent, ToolCall, Usage } from './messages';

/** Frozen shape of pi's AgentToolResult: model-facing content plus tool-specific structured details for UI rendering. */
export type ToolExecutionResult = {
  content: (TextContent | ImageContent)[];
  details: unknown;
  /** Usage from the tool execution itself; not part of main LLM context accounting. */
  usage?: Usage;
  /** Tools introduced by this result, available from this transcript point onward. */
  addedToolNames?: string[];
  /** Hint to stop after the current tool batch when every result in the batch sets it. */
  terminate?: boolean;
};

/**
 * Frozen copy of pi's agent event vocabulary (pi-agent-core 0.84.2), carried
 * over SSE. Type names and event tags match pi verbatim; payload deviations,
 * each deliberate:
 * - assistant stream events drop pi's cumulative `partial`, and
 *   `message_update` drops the partial `message` (deltas only — message_end
 *   is authoritative), keeping frames O(delta) instead of O(message²);
 * - `done` drops the final message for the same reason and carries usage;
 *   `error` likewise drops pi's error AssistantMessage payload;
 * - `turn_end` drops `message`/`toolResults` (both already delivered via
 *   message_end / tool_execution_end);
 * - `agent_end` drops the messages array and carries a willRetry annotation;
 * - Atrium-owned events (approval_*, notice) extend the union in the same
 *   snake_case style.
 * Reducers must ignore unknown event types — new ones may appear.
 */

export type AssistantMessageEvent =
  | { type: 'start' }
  | { type: 'text_start'; contentIndex: number }
  | { type: 'text_delta'; contentIndex: number; delta: string }
  | { type: 'text_end'; contentIndex: number; content: string }
  | { type: 'thinking_start'; contentIndex: number }
  | { type: 'thinking_delta'; contentIndex: number; delta: string }
  | { type: 'thinking_end'; contentIndex: number; content: string }
  | { type: 'toolcall_start'; contentIndex: number }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall }
  | {
      type: 'done';
      reason: Extract<StopReason, 'stop' | 'length' | 'toolUse' | 'deferred'>;
      usage?: Usage;
    }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'> };

export type AgentSessionEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start' }
  | { type: 'message_start'; message: Message }
  | { type: 'message_update'; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'message_end'; message: Message }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool_execution_update';
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: ToolExecutionResult;
      isError: boolean;
    }
  | { type: 'turn_end' }
  | { type: 'agent_end'; willRetry: boolean }
  // Atrium extensions
  | { type: 'approval_requested'; approvalId: string; toolCallId: string; reason: string }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'notice'; name: string; payload: unknown };

/**
 * seq is monotonic per stream; reconnecting clients pass their last seen seq
 * and the server replays the gap, making the replay/live seam idempotent.
 */
export type EventEnvelope = {
  v: 1;
  seq: number;
  event: AgentSessionEvent;
};

export const PROTOCOL_VERSION = 1 as const;
