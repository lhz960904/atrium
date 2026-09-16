import { describe, expect, test } from 'bun:test';
import type { InteractionRequest } from '@shared/interactions';
import type { AgentSessionEvent, AssistantMessage, Content } from '@shared/protocol';
import { getPendingApprovals } from '../../approvals';
import { RunAssembler, type RunSnapshot } from '../reduce';

/**
 * Fixtures in the protocol's own vocabulary — the assembler's real input. A
 * turn is bracketed by message_start / message_end, with the streaming events
 * in between; message_end carries the authoritative content the reducer
 * reconciles against.
 */

const usage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const assistant = (content: Content[]): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'p',
  model: 'm',
  usage: usage(),
  stopReason: 'stop',
  timestamp: 0,
});

const update = (assistantMessageEvent: unknown): AgentSessionEvent =>
  ({ type: 'message_update', assistantMessageEvent }) as AgentSessionEvent;

const open = (runId = 'm1'): AgentSessionEvent[] => [
  { type: 'run_started', runId },
  { type: 'agent_start' },
  { type: 'message_start', message: assistant([]) },
];

const close = (content: Content[]): AgentSessionEvent[] => [
  { type: 'message_end', message: assistant(content) },
  { type: 'agent_end' },
  { type: 'run_finished', status: 'completed' },
];

const text = (contentIndex: number, value: string) => [
  update({ type: 'text_start', contentIndex }),
  update({ type: 'text_delta', contentIndex, delta: value }),
  update({ type: 'text_end', contentIndex, content: value }),
];

const toolCall = (contentIndex: number, id: string, name: string, args: unknown) => [
  update({ type: 'toolcall_start', contentIndex, toolCallId: id, toolName: name }),
  update({
    type: 'toolcall_end',
    contentIndex,
    toolCall: { type: 'toolCall', id, name, arguments: args },
  }),
];

const toolEnd = (
  toolCallId: string,
  toolName: string,
  details: unknown,
  isError = false,
): AgentSessionEvent => ({
  type: 'tool_execution_end',
  toolCallId,
  toolName,
  result: { content: [{ type: 'text', text: String(details) }], details },
  isError,
});

const approvalRequest = (toolCallId: string, id = `ap-${toolCallId}`): InteractionRequest => ({
  id,
  runId: 'm1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: toolCallId, name: 'bash', arguments: {} },
  createdAt: 1,
});

function assemble(events: AgentSessionEvent[]): RunSnapshot {
  const assembler = new RunAssembler();
  for (const event of events) assembler.apply(event);
  return assembler.snapshot();
}

describe('text and reasoning', () => {
  test('rebuilds the message in the old part shape', () => {
    const { message, status } = assemble([
      ...open(),
      update({ type: 'thinking_start', contentIndex: 0 }),
      update({ type: 'thinking_delta', contentIndex: 0, delta: '推理' }),
      update({ type: 'thinking_end', contentIndex: 0, content: '推理' }),
      update({ type: 'text_start', contentIndex: 1 }),
      update({ type: 'text_delta', contentIndex: 1, delta: '你好' }),
      update({ type: 'text_delta', contentIndex: 1, delta: '世界' }),
      update({ type: 'text_end', contentIndex: 1, content: '你好世界' }),
      ...close([
        { type: 'thinking', thinking: '推理' },
        { type: 'text', text: '你好世界' },
      ]),
    ]);
    expect(status).toBe('done');
    expect(message?.id).toBe('m1');
    expect(message?.parts).toEqual([
      { type: 'step-start' },
      { type: 'reasoning', text: '推理', state: 'done' },
      { type: 'text', text: '你好世界', state: 'done' },
    ]);
  });

  test('mid-stream snapshot shows streaming text', () => {
    const { message, status } = assemble([
      ...open(),
      update({ type: 'text_start', contentIndex: 0 }),
      update({ type: 'text_delta', contentIndex: 0, delta: '半句' }),
    ]);
    expect(status).toBe('streaming');
    expect(message?.parts.at(-1)).toMatchObject({ type: 'text', text: '半句', state: 'streaming' });
  });
});

describe('tool turns', () => {
  test('tool call and result merge onto one part; turns are marked', () => {
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', 'bash', { command: 'ls' }),
      toolEnd('t1', 'bash', { stdout: 'a.txt' }),
      {
        type: 'message_end',
        message: assistant([
          { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } },
        ] as Content[]),
      },
      { type: 'message_start', message: assistant([]) },
      ...text(0, 'done'),
      ...close([{ type: 'text', text: 'done' }]),
    ]);
    expect(message?.parts).toEqual([
      { type: 'step-start' },
      {
        type: 'tool-bash',
        toolCallId: 't1',
        state: 'output-available',
        input: { command: 'ls' },
        output: { stdout: 'a.txt' },
        preliminary: undefined,
      },
      { type: 'step-start' },
      { type: 'text', text: 'done', state: 'done' },
    ]);
  });

  test('the tool part appears with its name while arguments stream', () => {
    const { message } = assemble([
      ...open(),
      update({ type: 'toolcall_start', contentIndex: 0, toolCallId: 't1', toolName: 'bash' }),
    ]);
    expect(message?.parts.at(-1)).toMatchObject({
      type: 'tool-bash',
      state: 'input-streaming',
    });
  });

  test('preliminary outputs update the part and the final one settles it', () => {
    const assembler = new RunAssembler();
    for (const event of [...open(), ...toolCall(0, 't1', 'screenshot', {})]) {
      assembler.apply(event);
    }
    assembler.apply({
      type: 'tool_execution_update',
      toolCallId: 't1',
      toolName: 'screenshot',
      args: {},
      partialResult: { content: [], details: { frame: 1 } },
    });
    expect(assembler.snapshot().message?.parts.at(-1)).toMatchObject({
      state: 'output-available',
      output: { frame: 1 },
      preliminary: true,
    });
    assembler.apply(toolEnd('t1', 'screenshot', { frame: 2 }));
    expect(assembler.snapshot().message?.parts.at(-1)).toMatchObject({
      output: { frame: 2 },
      preliminary: undefined,
    });
  });

  test('mcp tools become dynamic-tool parts', () => {
    const name = 'mcp__playwright__browser_click';
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', name, {}),
      toolEnd('t1', name, 'ok'),
      ...close([{ type: 'toolCall', id: 't1', name, arguments: {} }] as Content[]),
    ]);
    expect(message?.parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: name,
      state: 'output-available',
    });
  });

  test('a failed execution shows the text the tool returned', () => {
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', 'bash', {}),
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        // pi puts the reason in content; details stay whatever the tool set.
        result: { content: [{ type: 'text', text: 'exit 1' }], details: {} },
        isError: true,
      },
      ...close([{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }] as Content[]),
    ]);
    expect(message?.parts[1]).toMatchObject({ state: 'output-error', errorText: 'exit 1' });
  });

  test('a failure with nothing to quote still says something', () => {
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', 'bash', {}),
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: { content: [], details: {} },
        isError: true,
      },
      ...close([{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }] as Content[]),
    ]);
    expect(message?.parts[1]).toMatchObject({ state: 'output-error', errorText: 'Tool failed.' });
  });
});

describe('interactions', () => {
  test('an approval request pauses the part where getPendingApprovals finds it', () => {
    const request = approvalRequest('t1');
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', 'bash', { command: 'rm -rf /tmp/x' }),
      { type: 'interaction_requested', request },
    ]);
    expect(message?.parts[1]).toMatchObject({
      state: 'approval-requested',
      approval: { id: request.id },
    });
    const pending = getPendingApprovals([message as never]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ approvalId: request.id, toolName: 'bash', prefix: '$ ' });
  });

  test('an approved request waits for the real result instead of claiming success', () => {
    const request = approvalRequest('t1');
    const assembler = new RunAssembler();
    for (const event of [
      ...open(),
      ...toolCall(0, 't1', 'bash', {}),
      { type: 'interaction_requested', request } as AgentSessionEvent,
    ]) {
      assembler.apply(event);
    }
    assembler.apply({ type: 'interaction_resolved', request, outcome: { kind: 'approved' } });
    expect(assembler.snapshot().message?.parts[1]).toMatchObject({
      state: 'approval-responded',
      approval: { id: request.id, approved: true },
    });
    assembler.apply(toolEnd('t1', 'bash', { stdout: 'ok' }));
    expect(assembler.snapshot().message?.parts[1]).toMatchObject({
      state: 'output-available',
      output: { stdout: 'ok' },
    });
  });

  test('a denial is not overwritten by the error pi stands in for the blocked call', () => {
    const request = approvalRequest('t1');
    const { message } = assemble([
      ...open(),
      ...toolCall(0, 't1', 'bash', {}),
      { type: 'interaction_requested', request },
      { type: 'interaction_resolved', request, outcome: { kind: 'denied', reason: 'No' } },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'No' }], details: { errorText: 'No' } },
        isError: true,
      },
      ...close([{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }] as Content[]),
    ]);
    expect(message?.parts[1]).toMatchObject({
      state: 'output-denied',
      approval: { id: request.id, approved: false, reason: 'No' },
    });
  });

  test('a waiting request is found by its id and by its call until it is resolved', () => {
    const approval = approvalRequest('t1');
    const question: InteractionRequest = {
      id: 'q-t2',
      runId: 'm1',
      kind: 'clarification',
      toolCall: {
        type: 'toolCall',
        id: 't2',
        name: 'ask_clarification',
        arguments: { questions: [] },
      },
      createdAt: 1,
    };
    const assembler = new RunAssembler();
    for (const event of [
      ...open(),
      { type: 'interaction_requested', request: approval },
      { type: 'interaction_requested', request: question },
    ] as AgentSessionEvent[]) {
      assembler.apply(event);
    }
    expect(assembler.openInteraction(approval.id)).toEqual(approval);
    expect(assembler.openInteractionForTool('t2')).toEqual(question);
    assembler.apply({
      type: 'interaction_resolved',
      request: approval,
      outcome: { kind: 'approved' },
    });
    expect(assembler.openInteraction(approval.id)).toBeUndefined();
    expect(assembler.openInteractionForTool('t2')).toEqual(question);
  });
});

describe('run envelope', () => {
  test('metadata notices merge across start and finish', () => {
    const { message } = assemble([
      ...open(),
      { type: 'notice', name: 'message-metadata', payload: { createdAt: 111 } },
      ...text(0, 'hi'),
      { type: 'notice', name: 'message-metadata', payload: { durationMs: 5000, totalTokens: 9 } },
      ...close([{ type: 'text', text: 'hi' }]),
    ]);
    expect(message?.metadata).toMatchObject({ createdAt: 111, durationMs: 5000, totalTokens: 9 });
  });

  test('the loop ending is not the run ending', () => {
    const assembler = new RunAssembler();
    for (const event of [...open(), { type: 'agent_end' } as AgentSessionEvent]) {
      assembler.apply(event);
    }
    // Persistence, usage and cleanup still have to land.
    expect(assembler.snapshot().status).toBe('streaming');
    assembler.apply({ type: 'run_finished', status: 'completed' });
    expect(assembler.snapshot().status).toBe('done');
  });

  test('a failed run reports the reason its own event carries', () => {
    const { status, error } = assemble([
      ...open(),
      { type: 'agent_end' },
      { type: 'run_finished', status: 'failed', error: 'usage write failed' },
    ]);
    expect(status).toBe('done');
    expect(error).toBe('usage write failed');
  });

  test('an aborted run keeps whatever streamed', () => {
    const { message, status } = assemble([
      ...open(),
      update({ type: 'text_start', contentIndex: 0 }),
      update({ type: 'text_delta', contentIndex: 0, delta: '写到一半' }),
      { type: 'agent_end' },
      { type: 'run_finished', status: 'aborted', reason: 'user_cancelled' },
    ]);
    expect(status).toBe('done');
    expect(message?.parts.at(-1)).toMatchObject({ type: 'text', text: '写到一半' });
  });

  test('a run the user stopped ends without reporting an error', () => {
    const { status, error } = assemble([
      ...open(),
      {
        type: 'message_end',
        message: {
          ...assistant([]),
          stopReason: 'aborted',
          errorMessage: 'This operation was aborted',
        },
      },
      { type: 'agent_end' },
      { type: 'run_finished', status: 'aborted', reason: 'user_cancelled' },
    ]);
    expect(status).toBe('done');
    expect(error).toBeUndefined();
  });

  test('a provider failure still reports its error', () => {
    const { error } = assemble([
      ...open(),
      {
        type: 'message_end',
        message: { ...assistant([]), stopReason: 'error', errorMessage: 'rate limited' },
      },
      { type: 'agent_end' },
      { type: 'run_finished', status: 'failed', error: 'rate limited' },
    ]);
    expect(error).toBe('rate limited');
  });

  test('file notices append file parts', () => {
    const { message } = assemble([
      ...open(),
      {
        type: 'notice',
        name: 'file',
        payload: { url: 'data:image/png;base64,xx', mediaType: 'image/png' },
      },
      ...close([]),
    ]);
    expect(message?.parts.at(-1)).toEqual({
      type: 'file',
      url: 'data:image/png;base64,xx',
      mediaType: 'image/png',
    });
  });
});
