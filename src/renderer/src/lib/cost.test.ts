import { expect, test } from 'bun:test';
import type { AtriumMessageMetadata, AtriumUIMessage } from '@shared/chat';
import { aggregateUsage } from './cost';

/**
 * What the composer's readout shows. It used to reprice each turn from the
 * model's rates, which drifted from the bill the moment the token counts
 * changed meaning; these pin that it now only adds up what was reported.
 */

const turn = (metadata: AtriumMessageMetadata): AtriumUIMessage =>
  ({ id: 'm', role: 'assistant', parts: [], metadata }) as unknown as AtriumUIMessage;

test('the reported cost is added up as given, not derived from the tokens', () => {
  const agg = aggregateUsage([
    turn({
      totalTokens: 1_000,
      inputTokens: 40,
      cacheReadTokens: 960,
      cost: { input: 0.002, output: 0.5, cache: 0.001, total: 0.503 },
    }),
    turn({
      totalTokens: 10,
      outputTokens: 10,
      cost: { input: 0, output: 0.25, cache: 0, total: 0.25 },
    }),
  ]);

  // A turn that is almost entirely cache reads still costs what the provider
  // charged for it; nothing here recomputes that from a rate.
  expect(agg.inputCost).toBeCloseTo(0.002, 10);
  expect(agg.outputCost).toBeCloseTo(0.75, 10);
  expect(agg.cacheCost).toBeCloseTo(0.001, 10);
  expect(agg.totalCost).toBeCloseTo(0.753, 10);
  expect(agg.totalTokens).toBe(1_010);
  expect(agg.costComplete).toBe(true);
});

test('a turn that reported no cost silences the readout rather than reading as free', () => {
  const agg = aggregateUsage([
    turn({ totalTokens: 100, cost: { input: 0.01, output: 0, cache: 0, total: 0.01 } }),
    turn({ totalTokens: 100 }),
  ]);

  expect(agg.totalTokens).toBe(200);
  expect(agg.costComplete).toBe(false);
});

test('turns with no usage at all are skipped', () => {
  expect(aggregateUsage([turn({ createdAt: 1 })])).toMatchObject({
    totalTokens: 0,
    totalCost: 0,
    costComplete: true,
  });
});
