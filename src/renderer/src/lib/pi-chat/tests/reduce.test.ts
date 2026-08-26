import { describe, expect, test } from 'bun:test';
import type { UIMessageChunk } from 'ai';
import { createProtocolBridge } from '../../../../../main/server/protocol-bridge';
import { getPendingApprovals } from '../../approvals';
import { RunAssembler, type RunSnapshot } from '../reduce';

/** End-to-end over the real edge: AI SDK chunks → bridge → assembler. */
function assemble(chunks: UIMessageChunk[]): RunSnapshot {
  const bridge = createProtocolBridge({ provider: 'deepseek', model: 'deepseek-chat' });
  const assembler = new RunAssembler();
  for (const chunk of chunks) for (const event of bridge.push(chunk)) assembler.apply(event);
  for (const event of bridge.finalize()) assembler.apply(event);
  return assembler.snapshot();
}

const open: UIMessageChunk[] = [{ type: 'start', messageId: 'm1' }, { type: 'start-step' }];

describe('text and reasoning', () => {
  test('rebuilds the message in the old part shape', () => {
    const { message, status } = assemble([
      ...open,
      { type: 'reasoning-start', id: 'r0' },
      { type: 'reasoning-delta', id: 'r0', delta: '推理' },
      { type: 'reasoning-end', id: 'r0' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: '你好' },
      { type: 'text-delta', id: 'b0', delta: '世界' },
      { type: 'text-end', id: 'b0' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
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
    const bridge = createProtocolBridge({ provider: 'p', model: 'm' });
    const assembler = new RunAssembler();
    for (const chunk of [
      ...open,
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: '打字中' },
    ] as UIMessageChunk[]) {
      for (const event of bridge.push(chunk)) assembler.apply(event);
    }
    const { message, status } = assembler.snapshot();
    expect(status).toBe('streaming');
    expect(message?.parts.at(-1)).toEqual({ type: 'text', text: '打字中', state: 'streaming' });
  });
});

describe('tool turns', () => {
  const toolTurn: UIMessageChunk[] = [
    ...open,
    { type: 'tool-input-start', toolCallId: 't1', toolName: 'bash' },
    { type: 'tool-input-delta', toolCallId: 't1', inputTextDelta: '{"command"' },
    { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: { command: 'ls' } },
    { type: 'tool-output-available', toolCallId: 't1', output: { stdout: 'a.txt' } },
    { type: 'finish-step' },
    { type: 'start-step' },
    { type: 'text-start', id: 'b1' },
    { type: 'text-delta', id: 'b1', delta: 'done' },
    { type: 'text-end', id: 'b1' },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ];

  test('tool call and result merge onto one part; steps are marked', () => {
    const { message } = assemble(toolTurn);
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
    const bridge = createProtocolBridge({ provider: 'p', model: 'm' });
    const assembler = new RunAssembler();
    for (const chunk of [
      ...open,
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'bash' },
    ] as UIMessageChunk[]) {
      for (const event of bridge.push(chunk)) assembler.apply(event);
    }
    expect(assembler.snapshot().message?.parts.at(-1)).toMatchObject({
      type: 'tool-bash',
      state: 'input-streaming',
    });
  });

  test('preliminary outputs update the part and the final one settles it', () => {
    const bridge = createProtocolBridge({ provider: 'p', model: 'm' });
    const assembler = new RunAssembler();
    const feed = (chunk: UIMessageChunk) => {
      for (const event of bridge.push(chunk)) assembler.apply(event);
    };
    for (const chunk of open) feed(chunk);
    feed({ type: 'tool-input-available', toolCallId: 't1', toolName: 'screenshot', input: {} });
    feed({
      type: 'tool-output-available',
      toolCallId: 't1',
      output: { frame: 1 },
      preliminary: true,
    });
    expect(assembler.snapshot().message?.parts.at(-1)).toMatchObject({
      state: 'output-available',
      output: { frame: 1 },
      preliminary: true,
    });
    feed({ type: 'tool-output-available', toolCallId: 't1', output: { frame: 2 } });
    expect(assembler.snapshot().message?.parts.at(-1)).toMatchObject({
      output: { frame: 2 },
      preliminary: undefined,
    });
  });

  test('mcp tools become dynamic-tool parts', () => {
    const { message } = assemble([
      ...open,
      {
        type: 'tool-input-available',
        toolCallId: 't1',
        toolName: 'mcp__playwright__browser_click',
        input: {},
      },
      { type: 'tool-output-available', toolCallId: 't1', output: 'ok' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(message?.parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'mcp__playwright__browser_click',
      state: 'output-available',
    });
  });

  test('errored executions surface errorText', () => {
    const { message } = assemble([
      ...open,
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: {} },
      { type: 'tool-output-error', toolCallId: 't1', errorText: 'exit 1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(message?.parts[1]).toMatchObject({ state: 'output-error', errorText: 'exit 1' });
  });
});

describe('approvals', () => {
  test('an approval request pauses the part where getPendingApprovals finds it', () => {
    const bridge = createProtocolBridge({ provider: 'p', model: 'm' });
    const assembler = new RunAssembler();
    for (const chunk of [
      ...open,
      {
        type: 'tool-input-available',
        toolCallId: 't1',
        toolName: 'bash',
        input: { command: 'rm -rf /tmp/x' },
      },
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 't1' },
    ] as UIMessageChunk[]) {
      for (const event of bridge.push(chunk)) assembler.apply(event);
    }
    const { message } = assembler.snapshot();
    expect(message?.parts[1]).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'a1' },
    });
    const pending = getPendingApprovals([message as never]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ approvalId: 'a1', toolName: 'bash', prefix: '$ ' });
  });

  test('a denied execution closes the part as output-denied', () => {
    const { message } = assemble([
      ...open,
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'bash', input: {} },
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 't1' },
      { type: 'tool-output-denied', toolCallId: 't1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(message?.parts[1]).toMatchObject({
      state: 'output-denied',
      approval: { id: 'a1', approved: false },
    });
  });
});

describe('run envelope', () => {
  test('metadata notices merge across start and finish', () => {
    const { message } = assemble([
      { type: 'start', messageId: 'm1', messageMetadata: { createdAt: 111 } },
      { type: 'start-step' },
      { type: 'text-start', id: 'b0' },
      { type: 'text-end', id: 'b0' },
      { type: 'finish-step' },
      {
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: { durationMs: 5000, totalTokens: 9 },
      },
    ]);
    expect(message?.metadata).toMatchObject({ createdAt: 111, durationMs: 5000, totalTokens: 9 });
  });

  test('stream errors surface on the snapshot and the run still ends', () => {
    const { status, error } = assemble([
      ...open,
      { type: 'text-start', id: 'b0' },
      { type: 'error', errorText: 'rate limited' },
    ]);
    expect(status).toBe('done');
    expect(error).toBe('rate limited');
  });

  test('an aborted run keeps whatever streamed', () => {
    const { message, status } = assemble([
      ...open,
      { type: 'text-start', id: 'b0' },
      { type: 'text-delta', id: 'b0', delta: '写到一半' },
      { type: 'abort' },
    ]);
    expect(status).toBe('done');
    expect(message?.parts.at(-1)).toMatchObject({ type: 'text', text: '写到一半' });
  });

  test('file notices append file parts', () => {
    const { message } = assemble([
      ...open,
      { type: 'file', url: 'data:image/png;base64,xx', mediaType: 'image/png' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(message?.parts.at(-1)).toEqual({
      type: 'file',
      url: 'data:image/png;base64,xx',
      mediaType: 'image/png',
    });
  });
});
