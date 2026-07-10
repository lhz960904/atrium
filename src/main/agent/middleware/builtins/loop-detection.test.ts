import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import type { RunContext } from '../types';
import { loopDetectionMiddleware } from './loop-detection';

const call = (id: string, name: string, input: unknown): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: name, input }],
});

const textOf = (m: ModelMessage | undefined): string =>
  typeof m?.content === 'string' ? m.content : '';

const freshCtx = (): RunContext => ({ scratch: new Map() }) as unknown as RunContext;

const history: ModelMessage[] = [{ role: 'user', content: 'fill the form' }];

/** Drive beforeStep like streamText: step 0 sees only history, each later step
 *  sees history plus every call made so far. */
async function stepThrough(ctx: RunContext, mw = loopDetectionMiddleware(), calls: ModelMessage[]) {
  const mws = calls.map((_, i) => [...history, ...calls.slice(0, i + 1)]);
  await mw.beforeStep?.(ctx, { stepNumber: 0, messages: history });
  let last: Awaited<ReturnType<NonNullable<typeof mw.beforeStep>>> = undefined;
  for (const [i, messages] of mws.entries()) {
    last = await mw.beforeStep?.(ctx, { stepNumber: i + 1, messages });
  }
  return last;
}

test('warns once when the same call repeats warnAt times', async () => {
  const mw = loopDetectionMiddleware();
  const ctx = freshCtx();
  const repeat = (i: number) => call(`c${i}`, 'browser_type', { text: 'hi' });

  await mw.beforeStep?.(ctx, { stepNumber: 0, messages: history });
  expect(
    await mw.beforeStep?.(ctx, { stepNumber: 1, messages: [...history, repeat(1)] }),
  ).toBeUndefined();
  expect(
    await mw.beforeStep?.(ctx, { stepNumber: 2, messages: [...history, repeat(1), repeat(2)] }),
  ).toBeUndefined();

  const o = await mw.beforeStep?.(ctx, {
    stepNumber: 3,
    messages: [...history, repeat(1), repeat(2), repeat(3)],
  });
  expect(textOf(o?.messages?.at(-1))).toContain('3 times');
  expect(o?.toolChoice).toBeUndefined();

  // Fourth repeat: already warned for this key, nothing new until the hard stop.
  expect(
    await mw.beforeStep?.(ctx, {
      stepNumber: 4,
      messages: [...history, repeat(1), repeat(2), repeat(3), repeat(4)],
    }),
  ).toBeUndefined();
});

test('cuts off tool use at stopAt and keeps it off for later steps', async () => {
  const ctx = freshCtx();
  const calls = [1, 2, 3, 4, 5].map((i) => call(`c${i}`, 'browser_type', { text: 'hi' }));
  const mw = loopDetectionMiddleware();
  const o = await stepThrough(ctx, mw, calls);
  expect(o?.toolChoice).toBe('none');
  expect(textOf(o?.messages?.at(-1))).toContain('disabled');

  // No new calls, but the stop must hold until the turn ends.
  const later = await mw.beforeStep?.(ctx, { stepNumber: 7, messages: [...history, ...calls] });
  expect(later?.toolChoice).toBe('none');
});

test('different arguments never accumulate into one loop', async () => {
  const calls = [1, 2, 3, 4, 5].map((i) => call(`c${i}`, 'bash', { command: `ls ${i}` }));
  expect(await stepThrough(freshCtx(), undefined, calls)).toBeUndefined();
});

test('argument key order does not split the identical-call key', async () => {
  const calls = [
    call('c1', 'edit', { a: 1, b: 2 }),
    call('c2', 'edit', { b: 2, a: 1 }),
    call('c3', 'edit', { a: 1, b: 2 }),
  ];
  const o = await stepThrough(freshCtx(), undefined, calls);
  expect(textOf(o?.messages?.at(-1))).toContain('3 times');
});

test('pre-run history is seeded, not counted', async () => {
  const mw = loopDetectionMiddleware();
  const ctx = freshCtx();
  const old = [1, 2, 3].map((i) => call(`h${i}`, 'bash', { command: 'ls' }));
  await mw.beforeStep?.(ctx, { stepNumber: 0, messages: [...history, ...old] });

  // Two fresh identical calls on top of three historical ones: still under warnAt.
  const fresh = [call('c1', 'bash', { command: 'ls' }), call('c2', 'bash', { command: 'ls' })];
  const o = await mw.beforeStep?.(ctx, {
    stepNumber: 1,
    messages: [...history, ...old, ...fresh],
  });
  expect(o).toBeUndefined();
});

test('ignores plain-text assistant messages', async () => {
  const mw = loopDetectionMiddleware();
  const ctx = freshCtx();
  const messages: ModelMessage[] = [...history, { role: 'assistant', content: 'thinking…' }];
  await mw.beforeStep?.(ctx, { stepNumber: 0, messages });
  expect(await mw.beforeStep?.(ctx, { stepNumber: 1, messages })).toBeUndefined();
});
