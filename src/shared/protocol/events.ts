import type { AgentEvent, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { AssistantMessageEvent as PiStreamEvent } from '@earendil-works/pi-ai';
import type { InteractionEvent, RunStopReason } from '../interactions';
import type { Message, ToolCall, Usage } from './messages';

/**
 * The wire between the run and its readers: pi's agent events as they are
 * carried over SSE, plus the events Atrium owns. Shapes are derived from pi's
 * own types so a version bump shows up here, and every deviation is a
 * transport decision declared at the derivation:
 * - a frame carries its delta, never the message so far: pi repeats the whole
 *   partial on every update, which would make one reply's stream grow with the
 *   square of its length. `message_end` is authoritative for a turn's content;
 * - `toolcall_start` inlines the call id and name pi only exposes through that
 *   partial, so a tool card can open while its arguments stream;
 * - `turn_end` and `agent_end` drop their messages, and `done` / `error` their
 *   final message — all of it was already delivered;
 * - only assistant messages are carried: the user's message arrived in the
 *   request body and a tool result comes through `tool_execution_end`.
 * A run's identity and its settlement are Atrium's own events: `run_started`
 * names the run, and `run_finished` reports the end of the app's work, which
 * outlasts pi's `agent_end`.
 * Reducers must ignore unknown event types — new ones may appear.
 */

type Pi<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;
type PiStream<T extends PiStreamEvent['type']> = Extract<PiStreamEvent, { type: T }>;

export type AssistantMessageEvent =
  | Pick<PiStream<'start'>, 'type'>
  | Pick<PiStream<'text_start' | 'thinking_start'>, 'type' | 'contentIndex'>
  | Pick<
      PiStream<'text_delta' | 'thinking_delta' | 'toolcall_delta'>,
      'type' | 'contentIndex' | 'delta'
    >
  | Pick<PiStream<'text_end' | 'thinking_end'>, 'type' | 'contentIndex' | 'content'>
  | (Pick<PiStream<'toolcall_start'>, 'type' | 'contentIndex'> & {
      toolCallId: string;
      toolName: string;
    })
  | (Pick<PiStream<'toolcall_end'>, 'type' | 'contentIndex'> & { toolCall: ToolCall })
  | (Pick<PiStream<'done'>, 'type' | 'reason'> & { usage?: Usage })
  | Pick<PiStream<'error'>, 'type' | 'reason'>;

/** Model-facing content plus the tool-specific details its card renders. */
export type ToolExecutionResult = AgentToolResult<unknown>;

/** How a run ended, as its last event states it. */
export type RunCompletion =
  | { status: 'completed' }
  | { status: 'aborted'; reason: RunStopReason }
  | { status: 'failed'; error: string };

export type AgentSessionEvent =
  | Pi<'agent_start' | 'turn_start'>
  | Pick<Pi<'turn_end' | 'agent_end'>, 'type'>
  | (Pick<Pi<'message_start' | 'message_end'>, 'type'> & { message: Message })
  | (Pick<Pi<'message_update'>, 'type'> & { assistantMessageEvent: AssistantMessageEvent })
  | (Omit<Pi<'tool_execution_start'>, 'args'> & { args: unknown })
  | (Omit<Pi<'tool_execution_update'>, 'args' | 'partialResult'> & {
      args: unknown;
      partialResult: unknown;
    })
  | (Omit<Pi<'tool_execution_end'>, 'result'> & { result: ToolExecutionResult })
  // Atrium extensions
  | InteractionEvent
  | { type: 'run_started'; runId: string }
  | ({ type: 'run_finished' } & RunCompletion)
  | { type: 'notice'; name: string; payload: unknown };

/**
 * seq is monotonic per stream; reconnecting clients pass their last seen seq
 * and the server replays the gap, making the replay/live seam idempotent.
 */
export type EventEnvelope = {
  seq: number;
  event: AgentSessionEvent;
};
