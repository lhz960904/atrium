import { expect, test } from 'bun:test';
import type { LanguageModel, UIMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { Db } from '../../../db';
import type { RunContext } from '../types';
import { titleMiddleware } from './title';

function modelReturning(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

function userMsg(text: string): UIMessage {
  return { id: 'u1', role: 'user', parts: [{ type: 'text', text }] };
}

function assistantMsg(): UIMessage {
  return { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'sure' }] };
}

function makeCtx(messages: UIMessage[], model: LanguageModel, emitted: unknown[]): RunContext {
  return {
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as RunContext['sandbox'],
    workspaceRoot: '/ws',
    request: { system: '', messages, tools: {} as RunContext['request']['tools'] },
    model,
    emit: (chunk) => emitted.push(chunk),
    scratch: new Map(),
  };
}

// beforeRun fires title generation without awaiting it; let the microtasks run.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

test('generates and persists a title on the first turn', async () => {
  const titles: string[] = [];
  const emitted: unknown[] = [];
  const mw = titleMiddleware((_db, _id, title) => titles.push(title));
  await mw.beforeRun?.(
    makeCtx([userMsg('Help me fix the login bug')], modelReturning('Fix login bug'), emitted),
  );
  await flush();
  expect(titles).toEqual(['Fix login bug']);
  expect(emitted.some((c) => (c as { type?: string }).type === 'data-title')).toBe(true);
});

test('strips wrapping quotes and a trailing period the model adds', async () => {
  const titles: string[] = [];
  const mw = titleMiddleware((_db, _id, title) => titles.push(title));
  await mw.beforeRun?.(makeCtx([userMsg('write a sort')], modelReturning('"Sort an array."'), []));
  await flush();
  expect(titles).toEqual(['Sort an array']);
});

test('skips generation when the turn is not the first (assistant present)', async () => {
  const titles: string[] = [];
  const mw = titleMiddleware((_db, _id, title) => titles.push(title));
  await mw.beforeRun?.(
    makeCtx([userMsg('hi'), assistantMsg(), userMsg('next')], modelReturning('Nope'), []),
  );
  await flush();
  expect(titles).toEqual([]);
});

test('skips generation when the first user message has no text', async () => {
  const titles: string[] = [];
  const mw = titleMiddleware((_db, _id, title) => titles.push(title));
  await mw.beforeRun?.(makeCtx([userMsg('   ')], modelReturning('X'), []));
  await flush();
  expect(titles).toEqual([]);
});
