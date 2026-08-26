import { describe, expect, test } from 'bun:test';
import type { AgentSessionEvent, AssistantMessage } from '@shared/protocol';
import type { UIMessageChunk } from 'ai';
import { createProtocolBridge } from '../protocol-bridge';

const bridge = () =>
  createProtocolBridge({ provider: 'deepseek', model: 'deepseek-chat', now: () => 1000 });

function run(chunks: UIMessageChunk[]): AgentSessionEvent[] {
  const b = bridge();
  const events = chunks.flatMap((chunk) => b.push(chunk));
  return [...events, ...b.finalize()];
}

const types = (events: AgentSessionEvent[]) => events.map((e) => e.type);

function updates(events: AgentSessionEvent[]) {
  return events
    .filter((e) => e.type === 'message_update')
    .map(
      (e) => (e as Extract<AgentSessionEvent, { type: 'message_update' }>).assistantMessageEvent,
    );
}

function lastMessage(events: AgentSessionEvent[]): AssistantMessage {
  const ends = events.filter((e) => e.type === 'message_end');
  const last = ends.at(-1) as Extract<AgentSessionEvent, { type: 'message_end' }>;
  return last.message as AssistantMessage;
}

/** Every bracket pair balances and the stream is terminated by agent_end. */
function expectWellFormed(events: AgentSessionEvent[]) {
  expect(types(events).at(-1)).toBe('agent_end');
  const count = (t: string) => events.filter((e) => e.type === t).length;
  expect(count('message_start')).toBe(count('message_end'));
  expect(count('turn_start')).toBe(count('turn_end'));
  expect(count('tool_execution_start')).toBe(count('tool_execution_end'));
}

const textTurn: UIMessageChunk[] = [
  { type: 'start', messageId: 'm1' },
  { type: 'start-step' },
  { type: 'text-start', id: 'b0' },
  { type: 'text-delta', id: 'b0', delta: '你好' },
  { type: 'text-delta', id: 'b0', delta: '世界' },
  { type: 'text-end', id: 'b0' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' },
];

describe('text-only run', () => {
  test('emits the full pi bracket sequence', () => {
    const events = run(textTurn);
    expect(types(events)).toEqual([
      'agent_start',
      'turn_start',
      'message_start',
      'message_update', // start
      'message_update', // text_start
      'message_update', // text_delta
      'message_update', // text_delta
      'message_update', // text_end
      'message_update', // done
      'message_end',
      'turn_end',
      'agent_end',
    ]);
    expectWellFormed(events);
  });

  test('assembles the assistant message with accumulated text', () => {
    const events = run(textTurn);
    const message = lastMessage(events);
    expect(message.content).toEqual([{ type: 'text', text: '你好世界' }]);
    expect(message.stopReason).toBe('stop');
    expect(message.provider).toBe('deepseek');
    const done = updates(events).at(-1);
    expect(done).toMatchObject({ type: 'done', reason: 'stop' });
  });

  test('message_start and message_end carry the run message id', () => {
    const events = run(textTurn);
    const start = events.find((e) => e.type === 'message_start');
    expect(start).toMatchObject({ messageId: 'm1' });
    expect(events.find((e) => e.type === 'message_end')).toMatchObject({ messageId: 'm1' });
  });
});

describe('tool step then text step', () => {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: 'm1' },
    { type: 'start-step' },
    { type: 'tool-input-start', toolCallId: 't1', toolName: 'bash' },
    { type: 'tool-input-delta', toolCallId: 't1', inputTextDelta: '{"cmd":' },
    { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: { cmd: 'ls' } },
    { type: 'tool-output-available', toolCallId: 't1', output: { stdout: 'a.txt' } },
    { type: 'finish-step' },
    { type: 'start-step' },
    { type: 'text-start', id: 'b1' },
    { type: 'text-delta', id: 'b1', delta: 'done' },
    { type: 'text-end', id: 'b1' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ];

  test('closes the assistant message before tool execution starts', () => {
    const events = run(chunks);
    const sequence = types(events);
    const messageEnd = sequence.indexOf('message_end');
    const execStart = sequence.indexOf('tool_execution_start');
    expect(messageEnd).toBeGreaterThan(-1);
    expect(execStart).toBeGreaterThan(messageEnd);
    expectWellFormed(events);
  });

  test('first message ends with toolUse and carries the toolCall content', () => {
    const events = run(chunks);
    const firstEnd = events.find((e) => e.type === 'message_end') as Extract<
      AgentSessionEvent,
      { type: 'message_end' }
    >;
    const message = firstEnd.message as AssistantMessage;
    expect(message.stopReason).toBe('toolUse');
    expect(message.content).toEqual([
      { type: 'toolCall', id: 't1', name: 'bash', arguments: { cmd: 'ls' } },
    ]);
  });

  test('tool_execution_end carries the engine output verbatim in details', () => {
    const events = run(chunks);
    const end = events.find((e) => e.type === 'tool_execution_end');
    expect(end).toMatchObject({
      toolName: 'bash',
      isError: false,
      result: { content: [], details: { stdout: 'a.txt' } },
    });
  });

  test('each step opens its own turn and message, contentIndex restarting', () => {
    const events = run(chunks);
    expect(types(events).filter((t) => t === 'turn_start')).toHaveLength(2);
    const textStart = updates(events).find((u) => u.type === 'text_start');
    expect(textStart).toMatchObject({ contentIndex: 0 });
  });
});

describe('tool execution edges', () => {
  test('preliminary outputs stream as tool_execution_update', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'screenshot', input: {} },
      { type: 'tool-output-available', toolCallId: 't1', output: { step: 1 }, preliminary: true },
      { type: 'tool-output-available', toolCallId: 't1', output: { step: 2 } },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const update = events.find((e) => e.type === 'tool_execution_update');
    expect(update).toMatchObject({ partialResult: { details: { step: 1 } } });
    expect(events.find((e) => e.type === 'tool_execution_end')).toMatchObject({
      result: { details: { step: 2 } },
    });
    expectWellFormed(events);
  });

  test('input-available without input-start still balances toolcall brackets', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: { cmd: 'ls' } },
      { type: 'tool-output-available', toolCallId: 't1', output: 'ok' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const kinds = updates(events).map((u) => u.type);
    expect(kinds).toContain('toolcall_start');
    expect(kinds).toContain('toolcall_end');
    expectWellFormed(events);
  });

  test('denied and errored outputs end the execution as errors', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: {} },
      { type: 'tool-output-denied', toolCallId: 't1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(events.find((e) => e.type === 'tool_execution_end')).toMatchObject({
      isError: true,
      result: { details: { denied: true } },
    });
    expectWellFormed(events);
  });

  test('approval requests map to the approval_requested extension', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: {} },
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 't1' },
      { type: 'tool-output-denied', toolCallId: 't1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(events.find((e) => e.type === 'approval_requested')).toMatchObject({
      approvalId: 'a1',
      toolCallId: 't1',
    });
  });
});

describe('finish reason mapping', () => {
  const finishWith = (finishReason: 'length' | 'content-filter' | 'other' | 'error') =>
    run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: 'x' },
      { type: 'text-end', id: 'b0' },
      { type: 'finish-step' },
      { type: 'finish', finishReason },
    ]);

  test('length maps to done(length)', () => {
    expect(lastMessage(finishWith('length')).stopReason).toBe('length');
  });

  test('other maps to done(stop) with rawStopReason preserved', () => {
    const message = lastMessage(finishWith('other'));
    expect(message.stopReason).toBe('stop');
    expect(message.rawStopReason).toBe('other');
  });

  test('content-filter maps to error with rawStopReason and errorMessage', () => {
    const events = finishWith('content-filter');
    const message = lastMessage(events);
    expect(message.stopReason).toBe('error');
    expect(message.rawStopReason).toBe('content-filter');
    expect(message.errorMessage).toContain('content filter');
    expect(updates(events).at(-1)).toMatchObject({ type: 'error', reason: 'error' });
    expectWellFormed(events);
  });

  test('error maps to the error stream event', () => {
    expect(lastMessage(finishWith('error')).stopReason).toBe('error');
  });
});

describe('interruption and closure', () => {
  test('abort closes the open message as aborted and ends the stream', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: 'partial' },
      { type: 'abort' },
    ]);
    const message = lastMessage(events);
    expect(message.stopReason).toBe('aborted');
    expect(message.content).toEqual([{ type: 'text', text: 'partial' }]);
    expect(updates(events).at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expectWellFormed(events);
  });

  test('chunks after the stream ended are ignored', () => {
    const b = bridge();
    for (const chunk of textTurn) b.push(chunk);
    expect(b.push({ type: 'text-delta', id: 'b0', delta: 'late' })).toEqual([]);
    expect(b.finalize()).toEqual([]);
  });

  test('finalize seals a dangling tool execution and every open bracket', () => {
    const b = bridge();
    const events = [
      { type: 'start', messageId: 'm1' } as UIMessageChunk,
      { type: 'start-step' } as UIMessageChunk,
      {
        type: 'tool-input-available',
        toolCallId: 't1',
        toolName: 'bash',
        input: {},
      } as UIMessageChunk,
      {
        type: 'tool-output-available',
        toolCallId: 't1',
        output: { step: 1 },
        preliminary: true,
      } as UIMessageChunk,
    ].flatMap((chunk) => b.push(chunk));
    const tail = b.finalize();
    expect(tail.find((e) => e.type === 'tool_execution_end')).toMatchObject({
      isError: true,
      result: { details: { aborted: true } },
    });
    expectWellFormed([...events, ...tail]);
  });

  test('stream error surfaces as message error plus notice', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'b0' },
      { type: 'error', errorText: 'API rate limited' },
    ]);
    expect(lastMessage(events).errorMessage).toBe('API rate limited');
    expect(events.find((e) => e.type === 'notice')).toMatchObject({
      name: 'stream-error',
      payload: { errorText: 'API rate limited' },
    });
    expectWellFormed(events);
  });
});

describe('sidecar chunks', () => {
  test('data-* parts pass through as notices with the prefix stripped', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'data-title', data: { title: '新任务' } } as UIMessageChunk,
      { type: 'start-step' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(events.find((e) => e.type === 'notice')).toMatchObject({
      name: 'title',
      payload: { data: { title: '新任务' } },
    });
  });

  test('turn metadata folds into the open message and goes out as a notice', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-end', id: 'b0' },
      { type: 'finish-step' },
      {
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: { inputTokens: 10, outputTokens: 5, totalTokens: 15, durationMs: 1200 },
      },
    ]);
    const message = lastMessage(events);
    expect(message.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
    expect(events.find((e) => e.type === 'notice')).toMatchObject({
      name: 'message-metadata',
      payload: { durationMs: 1200 },
    });
  });

  test('reasoning streams as thinking blocks alongside text', () => {
    const events = run([
      { type: 'start', messageId: 'm1' },
      { type: 'start-step' },
      { type: 'reasoning-start', id: 'r0' },
      { type: 'reasoning-delta', id: 'r0', delta: 'hmm' },
      { type: 'reasoning-end', id: 'r0' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: 'hi' },
      { type: 'text-end', id: 'b0' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(lastMessage(events).content).toEqual([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'hi' },
    ]);
    const kinds = updates(events).map((u) => u.type);
    expect(kinds).toContain('thinking_delta');
  });
});
