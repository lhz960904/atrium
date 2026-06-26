import { expect, test } from 'bun:test';
import type { ModelPricing } from '../agent/models/types';
import { costMicros } from './usage';

// claude-opus-4-5 rates (per token) from the litellm snapshot.
const OPUS: ModelPricing = {
  input: 0.000005,
  output: 0.000025,
  cacheRead: 0.0000005,
  cacheCreation: 0.00000625,
};

test('costMicros: plain input + output, no cache', () => {
  // 1000*5e-6 + 500*25e-6 = 0.005 + 0.0125 = 0.0175 USD
  expect(
    costMicros(
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 },
      OPUS,
    ),
  ).toBe(17_500);
});

test('costMicros: cache read billed at the cheap tier, input is inclusive', () => {
  // inputTokens(1000) includes 800 cache reads → 200 noCache.
  // 200*5e-6 + 800*5e-7 + 500*25e-6 = 0.001 + 0.0004 + 0.0125 = 0.0139 USD
  expect(
    costMicros(
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 800, cacheCreationTokens: 0 },
      OPUS,
    ),
  ).toBe(13_900);
});

test('costMicros: cache creation billed at the dear tier', () => {
  // 600 noCache + 400 cache-creation, no output.
  // 600*5e-6 + 400*6.25e-6 = 0.003 + 0.0025 = 0.0055 USD
  expect(
    costMicros(
      { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 400 },
      OPUS,
    ),
  ).toBe(5_500);
});

test('costMicros: unknown model (zero pricing) costs nothing', () => {
  const free: ModelPricing = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  expect(
    costMicros(
      { inputTokens: 9999, outputTokens: 9999, cacheReadTokens: 1, cacheCreationTokens: 1 },
      free,
    ),
  ).toBe(0);
});

test('costMicros: cache tokens never push noCache below zero', () => {
  // cacheRead+creation exceeds inputTokens → noCache clamps to 0, only cache billed.
  // 0*input + 700*5e-7 + 400*6.25e-6 = 0.00035 + 0.0025 = 0.00285 USD
  expect(
    costMicros(
      { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 700, cacheCreationTokens: 400 },
      OPUS,
    ),
  ).toBe(2_850);
});
