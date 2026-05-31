import { expect, test } from 'bun:test';
import { metadataMiddleware } from './metadata';

test('stamps createdAt on start and duration + tokens on finish', () => {
  const mw = metadataMiddleware();
  const start = mw.messageMetadata?.({ type: 'start' }) as { createdAt: number };
  expect(typeof start.createdAt).toBe('number');

  const finish = mw.messageMetadata?.({ type: 'finish', totalUsage: { totalTokens: 42 } }) as {
    durationMs: number;
    totalTokens: number;
  };
  expect(finish.totalTokens).toBe(42);
  expect(typeof finish.durationMs).toBe('number');
  expect(finish.durationMs).toBeGreaterThanOrEqual(0);
});

test('returns nothing for the per-step lifecycle parts', () => {
  const mw = metadataMiddleware();
  expect(mw.messageMetadata?.({ type: 'start-step' })).toBeUndefined();
  expect(mw.messageMetadata?.({ type: 'finish-step' })).toBeUndefined();
});

test('passes through a missing token count as undefined', () => {
  const mw = metadataMiddleware();
  const finish = mw.messageMetadata?.({ type: 'finish' }) as { totalTokens?: number };
  expect(finish.totalTokens).toBeUndefined();
});
