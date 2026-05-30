import { expect, test } from 'bun:test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { UIMessage } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { runAgent } from './run';

function textModel(text: string) {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

async function collectAssistants(text: string): Promise<UIMessage[]> {
  const captured: UIMessage[] = [];
  const userMsg: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
  const res = await runAgent({
    model: textModel(text),
    messages: [userMsg],
    onFinish: (a) => captured.push(a),
  });
  await res.text(); // consume the stream so onFinish fires
  return captured;
}

test('runAgent streams text into the assistant message', async () => {
  const [assistant] = await collectAssistants('Hello world');
  expect(assistant?.role).toBe('assistant');
  const text = assistant?.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
  expect(text).toBe('Hello world');
});

test('assistant message gets a non-empty id (regression: empty id collided on persist)', async () => {
  const a = await collectAssistants('one');
  const b = await collectAssistants('two');
  expect(a[0]?.id).toBeTruthy();
  expect(b[0]?.id).toBeTruthy();
  expect(a[0]?.id).not.toBe(b[0]?.id);
});
