import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { costUsd, type TokenCounts, type TokenRates } from '../../shared/cost';
import type { Db } from '.';
import { usage } from './schema';

export type UsageKind = 'chat' | 'subagent' | 'title' | 'summary' | 'review';

/** Micro-USD (1e-6 dollar) cost of one call — integer for ledger storage. */
export function costMicros(t: TokenCounts, pricing: TokenRates): number {
  return Math.round(costUsd(t, pricing) * 1_000_000);
}

export type RecordUsageInput = {
  threadId: string;
  messageId?: string;
  providerId: string;
  modelId: string;
  kind: UsageKind;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
};

/**
 * Append one LLM call to the usage ledger. Rates are passed in (the caller
 * resolves the model) so this module doesn't reach into the provider layer and
 * stays unit-testable. No-token calls are skipped.
 */
export function recordUsage(db: Db, input: RecordUsageInput, pricing: TokenRates): void {
  const tokens: TokenCounts = {
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    cacheCreationTokens: input.cacheCreationTokens ?? 0,
  };
  const totalTokens = input.totalTokens ?? tokens.inputTokens + tokens.outputTokens;
  if (totalTokens === 0) return;
  db.insert(usage)
    .values({
      id: randomUUID(),
      threadId: input.threadId,
      messageId: input.messageId ?? null,
      providerId: input.providerId,
      modelId: input.modelId,
      kind: input.kind,
      ...tokens,
      totalTokens,
      costUsdMicros: costMicros(tokens, pricing),
    })
    .run();
}

/**
 * Reading the ledger back.
 *
 * These aggregates live beside the write because they are the same schema seen
 * from the other end: a column renamed here has to be renamed in all four, and
 * a reader in another module would not be looked at. Like `recordUsage`, they
 * take rates from the caller rather than reaching into the provider layer.
 */

export const USAGE_RANGES = ['7d', '30d', 'month', 'year', 'all'] as const;
/** Period the usage page aggregates over; `year` also drives the heatmap. */
export type UsageRange = (typeof USAGE_RANGES)[number];

/** Resolves a model's current rates — cost estimates are priced at today's rates. */
export type RatesResolver = (providerId: string, modelId: string) => TokenRates;

/** Inclusive lower bound (ms) for a range; rows are filtered on created_at. */
function rangeStartMs(range: UsageRange): number {
  const now = Date.now();
  switch (range) {
    case '7d':
      return now - 7 * 86_400_000;
    case '30d':
      return now - 30 * 86_400_000;
    case 'month': {
      const d = new Date(now);
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    case 'year':
      return now - 365 * 86_400_000;
    case 'all':
      return 0;
  }
}

type SummaryRow = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costMicros: number;
  calls: number;
  chatCalls: number;
  subagentCalls: number;
};
type ModelRow = { providerId: string; modelId: string; cacheRead: number };
type DayRow = { day: string; tokens: number; costMicros: number };
type DayModelRow = { day: string; modelId: string; tokens: number; costMicros: number };

/** Headline totals for the period's stat cards, including estimated cache savings. */
export function usageSummary(db: Db, range: UsageRange, ratesOf: RatesResolver) {
  const start = rangeStartMs(range);
  const totals = (
    db.all(sql`
      SELECT COALESCE(SUM(total_tokens), 0) AS "totalTokens",
             COALESCE(SUM(input_tokens), 0) AS "inputTokens",
             COALESCE(SUM(output_tokens), 0) AS "outputTokens",
             COALESCE(SUM(cache_read_tokens), 0) AS "cacheReadTokens",
             COALESCE(SUM(cache_creation_tokens), 0) AS "cacheCreationTokens",
             COALESCE(SUM(cost_usd_micros), 0) AS "costMicros",
             COUNT(*) AS "calls",
             COALESCE(SUM(CASE WHEN kind = 'chat' THEN 1 ELSE 0 END), 0) AS "chatCalls",
             COALESCE(SUM(CASE WHEN kind = 'subagent' THEN 1 ELSE 0 END), 0) AS "subagentCalls"
      FROM usage WHERE created_at >= ${start}`) as SummaryRow[]
  )[0];

  // Estimated cache savings: each cache-read token would have cost the full
  // input rate; it was billed at the (much cheaper) cache-read rate instead.
  // Uses current pricing — an estimate, like the rest of the cost display.
  const byModel = db.all(sql`
    SELECT provider_id AS "providerId", model_id AS "modelId",
           COALESCE(SUM(cache_read_tokens), 0) AS "cacheRead"
    FROM usage WHERE created_at >= ${start} AND cache_read_tokens > 0
    GROUP BY provider_id, model_id`) as ModelRow[];
  let cacheSavedUsd = 0;
  for (const model of byModel) {
    const rates = ratesOf(model.providerId, model.modelId);
    cacheSavedUsd += Number(model.cacheRead) * Math.max(0, rates.input - rates.cacheRead);
  }

  const inputTokens = Number(totals.inputTokens);
  const cacheReadTokens = Number(totals.cacheReadTokens);
  return {
    totalCostUsd: Number(totals.costMicros) / 1e6,
    totalTokens: Number(totals.totalTokens),
    inputTokens,
    outputTokens: Number(totals.outputTokens),
    cacheReadTokens,
    cacheCreationTokens: Number(totals.cacheCreationTokens),
    calls: Number(totals.calls),
    chatCalls: Number(totals.chatCalls),
    subagentCalls: Number(totals.subagentCalls),
    cacheSavedUsd,
    cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
  };
}

/** Per-day tokens and cost. The bar chart passes the period; the heatmap passes `year`. */
export function usageDaily(db: Db, range: UsageRange) {
  const rows = db.all(sql`
    SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS "day",
           COALESCE(SUM(total_tokens), 0) AS "tokens",
           COALESCE(SUM(cost_usd_micros), 0) AS "costMicros"
    FROM usage WHERE created_at >= ${rangeStartMs(range)}
    GROUP BY day ORDER BY day`) as DayRow[];
  return rows.map((row) => ({
    date: row.day,
    tokens: Number(row.tokens),
    costUsd: Number(row.costMicros) / 1e6,
  }));
}

/**
 * Per-day, per-model tokens and cost for the stacked "by model" bar view.
 * Long format (one row per day×model); the frontend pivots it. `models` is
 * sorted by total cost desc so the chart's bar order and legend stay stable.
 */
export function usageDailyByModel(db: Db, range: UsageRange) {
  const raw = db.all(sql`
    SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS "day",
           model_id AS "modelId",
           COALESCE(SUM(total_tokens), 0) AS "tokens",
           COALESCE(SUM(cost_usd_micros), 0) AS "costMicros"
    FROM usage WHERE created_at >= ${rangeStartMs(range)}
    GROUP BY day, model_id ORDER BY day`) as DayModelRow[];
  const rows = raw.map((row) => ({
    date: row.day,
    modelId: row.modelId,
    tokens: Number(row.tokens),
    costUsd: Number(row.costMicros) / 1e6,
  }));
  const costByModel = new Map<string, number>();
  for (const row of rows) {
    costByModel.set(row.modelId, (costByModel.get(row.modelId) ?? 0) + row.costUsd);
  }
  const models = [...costByModel.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
  return { models, rows };
}
