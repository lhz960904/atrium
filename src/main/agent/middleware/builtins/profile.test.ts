import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import type { RunContext } from '../types';
import { profileMiddleware } from './profile';

const userMsg = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
});
function ctxWith(messages: UIMessage[]): RunContext {
  return { request: { messages, system: '', tools: {} } } as unknown as RunContext;
}

test('injects USER.md as a <user-profile> block on the first user message', async () => {
  const ctx = ctxWith([userMsg('hi')]);
  await profileMiddleware({ readUser: async () => 'name: 昊泽\nLikes terse answers.' }).beforeRun?.(
    ctx,
  );

  const text = (ctx.request.messages[0].parts[0] as { text: string }).text;
  expect(text).toContain('<user-profile>');
  expect(text).toContain('Likes terse answers.');
  expect((ctx.request.messages[0].parts[1] as { text: string }).text).toBe('hi');
});

test('no USER.md → messages untouched', async () => {
  const original = [userMsg('hi')];
  const ctx = ctxWith(original);
  await profileMiddleware({ readUser: async () => '' }).beforeRun?.(ctx);
  expect(ctx.request.messages).toBe(original);
});
