import { describe, expect, test } from 'bun:test';
import type { AtriumUIMessage } from '@shared/chat';
import {
  mergeAssistantMessage,
  mergeUserMessage,
  splitAssistantMessage,
  splitUserMessage,
} from '../persist-convert';

const roundTripAssistant = (msg: AtriumUIMessage) =>
  mergeAssistantMessage(msg.id, splitAssistantMessage(msg));

describe('user messages', () => {
  test('text plus attachments round-trip verbatim', () => {
    const msg: AtriumUIMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        {
          type: 'file',
          url: 'data:image/png;base64,AAA',
          mediaType: 'image/png',
          filename: '截图.png',
        },
        {
          type: 'data-skill-mention',
          data: { name: 'verify' },
        } as unknown as AtriumUIMessage['parts'][number],
        { type: 'text', text: '看看这张图' },
      ],
      metadata: { createdAt: 1000 },
    };
    const row = splitUserMessage(msg);
    expect(row.role).toBe('user');
    expect((row.message as { timestamp: number }).timestamp).toBe(1000);
    expect(mergeUserMessage(row)).toEqual(msg);
  });
});

describe('assistant runs', () => {
  test('text and signed reasoning round-trip, metadata preserved', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'reasoning',
          text: '想一想',
          providerMetadata: { anthropic: { signature: 'sig123' } },
        } as AtriumUIMessage['parts'][number],
        { type: 'text', text: '答案' },
      ],
      metadata: { createdAt: 5, providerId: 'aihubmix', modelId: 'claude', totalTokens: 42 },
    };
    const rows = splitAssistantMessage(msg);
    expect(rows).toHaveLength(1);
    const stored = rows[0].message as {
      content: unknown[];
      stopReason: string;
      usage: { totalTokens: number };
    };
    expect(stored.content[0]).toEqual({
      type: 'thinking',
      thinking: '想一想',
      thinkingSignature: 'sig123',
    });
    expect(stored.stopReason).toBe('stop');
    expect(stored.usage.totalTokens).toBe(42);
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('a two-turn tool run becomes chronological pi rows and merges back', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-bash',
          toolCallId: 't1',
          state: 'output-available',
          input: { command: 'ls' },
          output: { stdout: 'a.txt' },
        } as AtriumUIMessage['parts'][number],
        { type: 'step-start' },
        { type: 'text', text: '完成' },
      ],
      metadata: { createdAt: 10, providerId: 'deepseek', modelId: 'chat' },
    };
    const rows = splitAssistantMessage(msg);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'toolResult', 'assistant']);
    expect(rows.map((r) => r.id)).toEqual(['a1:0', 't1', 'a1:1']);
    expect((rows[0].message as { stopReason: string }).stopReason).toBe('toolUse');
    expect((rows[1].message as { details: unknown }).details).toEqual({ stdout: 'a.txt' });
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('errored and denied tools round-trip their states', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-bash',
          toolCallId: 't1',
          state: 'output-error',
          input: {},
          errorText: 'exit 1',
        } as AtriumUIMessage['parts'][number],
        {
          type: 'tool-write_file',
          toolCallId: 't2',
          state: 'output-denied',
          input: { path: '/x' },
          approval: { id: 'ap1', approved: false },
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    const merged = roundTripAssistant(msg);
    expect(merged).toEqual(msg);
    const rows = splitAssistantMessage(msg);
    const denied = rows.find((r) => r.id === 't2')?.message as {
      isError: boolean;
      details: unknown;
    };
    expect(denied.isError).toBe(true);
    expect(denied.details).toEqual({ denied: true });
  });

  test('a pending approval and a streaming input survive via toolStates', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-bash',
          toolCallId: 't1',
          state: 'approval-requested',
          input: { command: 'rm x' },
          approval: { id: 'ap1' },
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    const rows = splitAssistantMessage(msg);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata?.toolStates).toEqual({
      t1: { state: 'approval-requested', approval: { id: 'ap1' } },
    });
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('client-side tools without output stay input-available', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-ask_clarification',
          toolCallId: 'c1',
          state: 'input-available',
          input: { questions: [] },
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('mcp dynamic tools keep their full name', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'dynamic-tool',
          toolName: 'mcp__playwright__browser_click',
          toolCallId: 't1',
          state: 'output-available',
          input: {},
          output: 'ok',
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    const rows = splitAssistantMessage(msg);
    expect((rows[0].message as { content: { name?: string }[] }).content[0].name).toBe(
      'mcp__playwright__browser_click',
    );
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('file and data-artifact parts pass through verbatim in place', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: '生成了' },
        { type: 'file', url: 'data:image/png;base64,BB', mediaType: 'image/png' },
        {
          type: 'data-artifact',
          data: { path: 'out.html' },
        } as unknown as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('compaction checkpoints keep their kind metadata', () => {
    const msg: AtriumUIMessage = {
      id: 'ck1',
      role: 'assistant',
      parts: [{ type: 'step-start' }, { type: 'text', text: '摘要…' }],
      metadata: { createdAt: 1, kind: 'compaction', coveredThroughId: 'm9' },
    };
    const rows = splitAssistantMessage(msg);
    expect(rows[0].metadata).toMatchObject({ kind: 'compaction', coveredThroughId: 'm9' });
    expect(roundTripAssistant(msg)).toEqual(msg);
  });

  test('a run without leading step-start still forms a turn', () => {
    const msg: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: '直接文本' }],
      metadata: { createdAt: 1 },
    };
    const rows = splitAssistantMessage(msg);
    expect(rows).toHaveLength(1);
    // Merge normalizes to the canonical leading-marker shape.
    expect(mergeAssistantMessage('a1', rows).parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: '直接文本' },
    ]);
  });
});
