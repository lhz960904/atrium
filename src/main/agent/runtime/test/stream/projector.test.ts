import { expect, test } from 'bun:test';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { projectAgentEvent } from '../../stream/projector';

/**
 * The wire's deviations from pi are all here, so this locks them in: a frame
 * carries the delta rather than the message so far, and everything the run
 * already delivered once is not sent again.
 */

const usage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const assistant = (content: unknown[] = []): AssistantMessage =>
  ({
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'p',
    model: 'm',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
  }) as unknown as AssistantMessage;

const project = (event: unknown) => projectAgentEvent(event as AgentEvent);

test('a delta frame carries the delta, not the message so far', () => {
  const partial = assistant([{ type: 'text', text: 'Hello so far' }]);
  const projected = project({
    type: 'message_update',
    message: partial,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' so far', partial },
  });
  expect(projected).toEqual({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' so far' },
  });
});

test('a tool call opens with the identity pi only puts in the partial', () => {
  const partial = assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }]);
  expect(
    project({
      type: 'message_update',
      message: partial,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial },
    }),
  ).toEqual({
    type: 'message_update',
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 0,
      toolCallId: 'c1',
      toolName: 'bash',
    },
  });
});

test('the loop ending is carried without the messages it already sent', () => {
  expect(project({ type: 'agent_end', messages: [assistant()] })).toEqual({ type: 'agent_end' });
  expect(project({ type: 'turn_end', message: assistant(), toolResults: [] })).toEqual({
    type: 'turn_end',
  });
});

test('only assistant messages reach the wire', () => {
  expect(
    project({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'bash',
        content: [],
        isError: false,
        timestamp: 0,
      },
    }),
  ).toBeNull();
  expect(
    project({ type: 'message_start', message: { role: 'user', content: 'hi', timestamp: 0 } }),
  ).toBeNull();
  expect(project({ type: 'message_start', message: assistant() })).toEqual({
    type: 'message_start',
    message: assistant(),
  });
});

test('a failed tool result travels as the tool returned it', () => {
  const result = { content: [{ type: 'text' as const, text: 'Permission denied' }], details: {} };
  const projected = project({
    type: 'tool_execution_end',
    toolCallId: 'c1',
    toolName: 'bash',
    result,
    isError: true,
  });
  expect(projected).toEqual({
    type: 'tool_execution_end',
    toolCallId: 'c1',
    toolName: 'bash',
    result,
    isError: true,
  });
  expect(projected).not.toHaveProperty('result.details.errorText');
});

test('no projected event carries a message id', () => {
  const partial = assistant([{ type: 'text', text: 'hi' }]);
  const events = [
    { type: 'agent_start' },
    { type: 'turn_start' },
    { type: 'message_start', message: assistant() },
    {
      type: 'message_update',
      message: partial,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi', partial },
    },
    { type: 'message_end', message: assistant([{ type: 'text', text: 'hi' }]) },
    { type: 'agent_end', messages: [] },
  ];
  for (const event of events) {
    expect(JSON.stringify(project(event) ?? {})).not.toContain('messageId');
  }
});
