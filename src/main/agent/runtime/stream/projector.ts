import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';
import type {
  AgentSessionEvent,
  AssistantMessageEvent,
  Message,
  ToolCall,
  ToolExecutionResult,
} from '@shared/protocol';

/**
 * pi's in-process `AgentEvent` → the wire's `AgentSessionEvent`. Near-identity:
 * the only work is the deviations the frozen protocol documents, all of them
 * serialization-boundary decisions rather than engine artifacts.
 *
 * - assistant stream events drop pi's cumulative `partial` (and `message_update`
 *   its partial `message`): a frame per delta that carries the whole message so
 *   far is O(message²) on the wire, and message_end is authoritative anyway;
 * - `toolcall_start` inlines the call id and name that pi only exposes through
 *   `partial`, so a renderer can open the tool card while arguments stream;
 * - `turn_end` drops message/toolResults and `agent_end` its messages array —
 *   all already delivered by message_end / tool_execution_end;
 * - message_start/message_end carry the run id as `messageId`: pi messages have
 *   no identity, and both the renderer and the stored rows reconcile by it.
 */

/** The tool call being opened, read off the partial pi only exposes there. */
function openingToolCall(
  partial: PiAssistantMessage,
  contentIndex: number,
): { toolCallId: string; toolName: string } {
  const block = partial.content[contentIndex] as { id?: unknown; name?: unknown } | undefined;
  return {
    toolCallId: typeof block?.id === 'string' ? block.id : '',
    toolName: typeof block?.name === 'string' ? block.name : '',
  };
}

type PiAssistantMessageEvent = Extract<
  AgentEvent,
  { type: 'message_update' }
>['assistantMessageEvent'];

function projectAssistantEvent(event: PiAssistantMessageEvent): AssistantMessageEvent {
  switch (event.type) {
    case 'start':
      return { type: 'start' };
    case 'text_start':
    case 'thinking_start':
      return { type: event.type, contentIndex: event.contentIndex };
    case 'text_delta':
    case 'thinking_delta':
    case 'toolcall_delta':
      return { type: event.type, contentIndex: event.contentIndex, delta: event.delta };
    case 'text_end':
    case 'thinking_end':
      return { type: event.type, contentIndex: event.contentIndex, content: event.content };
    case 'toolcall_start':
      return {
        type: 'toolcall_start',
        contentIndex: event.contentIndex,
        ...openingToolCall(event.partial, event.contentIndex),
      };
    case 'toolcall_end':
      return {
        type: 'toolcall_end',
        contentIndex: event.contentIndex,
        toolCall: event.toolCall as ToolCall,
      };
    case 'done':
      return { type: 'done', reason: event.reason, usage: event.message.usage };
    case 'error':
      return { type: 'error', reason: event.reason };
  }
}

/**
 * Project one pi event. Returns nothing for events the wire doesn't carry.
 * `messageId` is the run's id — every message in a run shares it, which is what
 * makes a run one assistant message to the renderer and one row group in the DB.
 */
export function projectAgentEvent(event: AgentEvent, messageId: string): AgentSessionEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };
    case 'turn_start':
      return { type: 'turn_start' };
    case 'turn_end':
      return { type: 'turn_end' };
    case 'agent_end':
      // pi retries inside the loop, so a run that reaches agent_end is final.
      return { type: 'agent_end', willRetry: false };
    case 'message_start':
      return { type: 'message_start', message: event.message as Message, messageId };
    case 'message_end':
      return { type: 'message_end', message: event.message as Message, messageId };
    case 'message_update':
      return {
        type: 'message_update',
        assistantMessageEvent: projectAssistantEvent(event.assistantMessageEvent),
      };
    case 'tool_execution_start':
      return {
        type: 'tool_execution_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case 'tool_execution_update':
      return {
        type: 'tool_execution_update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
      };
    case 'tool_execution_end':
      return {
        type: 'tool_execution_end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result as ToolExecutionResult,
        isError: event.isError,
      };
  }
}
