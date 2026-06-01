import { expect, test } from 'bun:test';
import type { MetadataPart } from '../types';
import { metadataMiddleware } from './metadata';

// The real stream part carries fields we don't read (finishReason, response, …);
// tests construct only what the middleware looks at.
const part = (p: Record<string, unknown>) => p as unknown as MetadataPart;

test('stamps createdAt on start and duration + tokens on finish', () => {
  const mw = metadataMiddleware();
  const start = mw.messageMetadata?.(part({ type: 'start' })) as { createdAt: number };
  expect(typeof start.createdAt).toBe('number');

  const finish = mw.messageMetadata?.(
    part({ type: 'finish', totalUsage: { totalTokens: 42 } }),
  ) as {
    durationMs: number;
    totalTokens: number;
  };
  expect(finish.totalTokens).toBe(42);
  expect(typeof finish.durationMs).toBe('number');
  expect(finish.durationMs).toBeGreaterThanOrEqual(0);
});

test('returns nothing for the per-step lifecycle parts', () => {
  const mw = metadataMiddleware();
  expect(mw.messageMetadata?.(part({ type: 'start-step' }))).toBeUndefined();
  expect(
    mw.messageMetadata?.(part({ type: 'finish-step', usage: { inputTokens: 1, outputTokens: 1 } })),
  ).toBeUndefined();
});

test('stamps contextTokens from the most recent finish-step usage', () => {
  const mw = metadataMiddleware();
  mw.messageMetadata?.(
    part({ type: 'finish-step', usage: { inputTokens: 100, outputTokens: 20 } }),
  );
  mw.messageMetadata?.(
    part({ type: 'finish-step', usage: { inputTokens: 300, outputTokens: 50 } }),
  );
  const finish = mw.messageMetadata?.(
    part({ type: 'finish', totalUsage: { totalTokens: 999 } }),
  ) as { contextTokens: number; totalTokens: number };
  expect(finish.contextTokens).toBe(350);
  expect(finish.totalTokens).toBe(999);
});

test('passes through a missing token count as undefined', () => {
  const mw = metadataMiddleware();
  const finish = mw.messageMetadata?.(part({ type: 'finish', totalUsage: {} })) as {
    totalTokens?: number;
  };
  expect(finish.totalTokens).toBeUndefined();
});
