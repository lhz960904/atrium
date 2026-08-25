import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Content, EventEnvelope } from '../index';
import { contentText, messageText } from '../index';

function assistant(content: Content[]): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1000,
  };
}

describe('content text extraction', () => {
  test('joins text parts and skips everything else', () => {
    const message = assistant([
      { type: 'text', text: '你好' },
      { type: 'thinking', thinking: 'hidden' },
      { type: 'text', text: '世界' },
      { type: 'toolCall', id: 't1', name: 'grep', arguments: {} },
    ]);
    expect(messageText(message)).toBe('你好世界');
  });

  test('accepts the user plain-string form', () => {
    expect(contentText('plain')).toBe('plain');
  });
});

describe('forward compatibility', () => {
  test('unknown content types survive a JSON round-trip untouched', () => {
    const exotic = { type: 'hologram', payload: { depth: 3 } };
    const message = assistant([{ type: 'text', text: 'known' }, exotic]);
    const revived = JSON.parse(JSON.stringify(message)) as AssistantMessage;
    expect(revived.content[1]).toEqual(exotic);
    expect(messageText(revived)).toBe('known');
  });

  test('envelopes serialize with stable version and seq', () => {
    const envelope: EventEnvelope = { v: 1, seq: 7, event: { type: 'agent_start' } };
    const revived = JSON.parse(JSON.stringify(envelope)) as EventEnvelope;
    expect(revived).toEqual(envelope);
  });
});
