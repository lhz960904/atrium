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
 * the only work is the payload deviations `shared/protocol/events.ts` declares,
 * all of them transport decisions rather than engine artifacts. A run's own
 * identity and settlement are separate events the run emits around this.
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

/** Project one pi event. Returns nothing for events the wire doesn't carry. */
export function projectAgentEvent(event: AgentEvent): AgentSessionEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };
    case 'turn_start':
      return { type: 'turn_start' };
    case 'turn_end':
      return { type: 'turn_end' };
    case 'agent_end':
      // The loop is done; the run's own bookkeeping still has to finish, which
      // is what run_finished reports.
      return { type: 'agent_end' };
    case 'message_start':
    case 'message_end':
      // pi announces every appended message; the user's arrived in the request
      // body and a tool result comes through tool_execution_end.
      if (event.message.role !== 'assistant') return null;
      return { type: event.type, message: event.message as Message };
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
