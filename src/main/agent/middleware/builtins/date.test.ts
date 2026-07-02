import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import type { RunContext } from '../types';
import { dateMiddleware } from './date';

const user = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});
const textOf = (m: UIMessage, i: number) => (m.parts[i] as { text: string }).text;

function ctxWith(messages: UIMessage[]): RunContext {
  return { request: { messages } } as unknown as RunContext;
}

// Local-time constructors (not UTC strings): currentDateNote formats in the
// machine's local zone, so building the Date in that same zone makes the asserted
// calendar date deterministic on any machine.

test('injects a date+time reminder onto the latest user turn', async () => {
  const ctx = ctxWith([user('u1', 'yesterday'), user('u2', 'today')]);
  await dateMiddleware(() => new Date(2026, 5, 30, 12, 0, 0)).beforeRun?.(ctx);

  const [first, last] = ctx.request.messages;
  expect(first.parts).toHaveLength(1); // earlier turn untouched → stays cacheable
  expect(textOf(last, 0)).toContain('<system-reminder>');
  expect(textOf(last, 0)).toContain('The current date and time is 2026-06-30 12:00');
  expect(textOf(last, 1)).toBe('today');
});

test('recomputes per call, so a later turn reflects a crossed-midnight date', async () => {
  let now = new Date(2026, 5, 30, 23, 59, 0);
  const mw = dateMiddleware(() => now);

  const ctx1 = ctxWith([user('u1', 'before midnight')]);
  await mw.beforeRun?.(ctx1);
  expect(textOf(ctx1.request.messages[0], 0)).toContain('2026-06-30');

  now = new Date(2026, 6, 1, 0, 1, 0);
  const ctx2 = ctxWith([user('u2', 'after midnight')]);
  await mw.beforeRun?.(ctx2);
  expect(textOf(ctx2.request.messages[0], 0)).toContain('2026-07-01');
});
