import { expect, test } from 'bun:test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { UIMessage } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { Db } from '../db';
import type { AgentMiddleware } from './middleware';
import { type RunAgentOptions, runAgent } from './run';
import type { Sandbox } from './sandbox/types';

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
  const capture: AgentMiddleware = {
    name: 'capture',
    afterRun: (_ctx, { message }) => {
      captured.push(message);
    },
  };
  const userMsg: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
  const stream = await runAgent({
    model: textModel(text),
    messages: [userMsg],
    workspaceRoot: '/tmp/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    tools: {} as RunAgentOptions['tools'],
    middlewares: [capture],
  });
  // Drain the chunk stream to completion so afterRun fires.
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
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
