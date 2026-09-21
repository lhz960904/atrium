import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { TokenRates } from '@shared/cost';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '.';
import * as schema from './schema';
import {
  costMicros,
  type RatesResolver,
  type UsageKind,
  usageDaily,
  usageDailyByModel,
  usageSummary,
} from './usage';

// claude-opus-4-5 rates (per token) from the litellm snapshot.
const OPUS: TokenRates = {
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
  const free: TokenRates = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
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

/**
 * Reading the ledger back. Against a real table, because what these pin is the
 * SQL: which rows a range admits, and that an empty period still answers with
 * zeros rather than with nothing.
 */

const DAY = 86_400_000;

function ledger() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE usage (
      id text PRIMARY KEY, thread_id text, message_id text,
      provider_id text NOT NULL, model_id text NOT NULL, kind text NOT NULL,
      input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
      cache_read_tokens integer NOT NULL DEFAULT 0, cache_creation_tokens integer NOT NULL DEFAULT 0,
      total_tokens integer NOT NULL DEFAULT 0, cost_usd_micros integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL DEFAULT 0);
  `);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;

  let n = 0;
  const call = (row: {
    kind?: UsageKind;
    modelId?: string;
    providerId?: string;
    at?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    costMicros?: number;
  }) =>
    raw
      .query(
        `INSERT INTO usage(id, provider_id, model_id, kind, input_tokens, output_tokens,
                           cache_read_tokens, total_tokens, cost_usd_micros, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `u${n++}`,
        row.providerId ?? 'anthropic',
        row.modelId ?? 'claude-x',
        row.kind ?? 'chat',
        row.input ?? 0,
        row.output ?? 0,
        row.cacheRead ?? 0,
        (row.input ?? 0) + (row.output ?? 0),
        row.costMicros ?? 0,
        row.at ?? Date.now(),
      );

  return { db, call };
}

const noRates: RatesResolver = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const localDay = (at: number) => new Date(at).toLocaleDateString('en-CA');

test('usageSummary: an empty period answers with zeros, not with nothing', () => {
  const summary = usageSummary(ledger().db, 'month', noRates);
  expect(summary.totalTokens).toBe(0);
  expect(summary.calls).toBe(0);
  // No rows means no input tokens, and the hit rate must not divide by zero.
  expect(summary.cacheHitRate).toBe(0);
});

test('usageSummary: the range excludes older rows, and kinds are counted apart', () => {
  const { db, call } = ledger();
  call({ kind: 'chat', input: 100, output: 10, at: Date.now() - DAY });
  call({ kind: 'subagent', input: 50, output: 5, at: Date.now() - 2 * DAY });
  call({ kind: 'chat', input: 900, output: 90, at: Date.now() - 40 * DAY });

  const week = usageSummary(db, '7d', noRates);
  expect(week).toMatchObject({ calls: 2, chatCalls: 1, subagentCalls: 1, totalTokens: 165 });
  expect(usageSummary(db, 'all', noRates).calls).toBe(3);
});

test('usageSummary: cache savings are priced per model by the caller, never below zero', () => {
  const { db, call } = ledger();
  call({ modelId: 'dear', cacheRead: 1000, input: 1000, at: Date.now() - DAY });
  call({ modelId: 'cheap', cacheRead: 2000, input: 2000, at: Date.now() - DAY });

  const asked: string[] = [];
  const summary = usageSummary(db, '7d', (providerId, modelId) => {
    asked.push(`${providerId}/${modelId}`);
    // 'cheap' reads cost more than its own input rate — a saving would be
    // negative, which is not a saving.
    return modelId === 'dear'
      ? { input: 0.00001, output: 0, cacheRead: 0.000001, cacheCreation: 0 }
      : { input: 0.000001, output: 0, cacheRead: 0.00001, cacheCreation: 0 };
  });

  expect(asked.sort()).toEqual(['anthropic/cheap', 'anthropic/dear']);
  expect(summary.cacheSavedUsd).toBeCloseTo(1000 * 0.000009, 10);
  expect(summary.cacheHitRate).toBeCloseTo(3000 / 3000, 10);
});

test('usageDaily: one row per local day', () => {
  const { db, call } = ledger();
  const today = Date.now();
  call({ input: 10, at: today });
  call({ input: 20, at: today });
  call({ input: 5, at: today - DAY });

  const days = usageDaily(db, '7d');
  expect(days).toHaveLength(2);
  expect(days.at(-1)).toMatchObject({ date: localDay(today), tokens: 30 });
});

test('usageDailyByModel: models are ordered by total cost, dearest first', () => {
  const { db, call } = ledger();
  call({ modelId: 'cheap', input: 10, costMicros: 1_000, at: Date.now() });
  call({ modelId: 'dear', input: 10, costMicros: 5_000, at: Date.now() });
  call({ modelId: 'cheap', input: 10, costMicros: 1_000, at: Date.now() - DAY });

  const { models, rows } = usageDailyByModel(db, '7d');
  // The chart's bar order and legend read straight off this.
  expect(models).toEqual(['dear', 'cheap']);
  expect(rows).toHaveLength(3);
});
