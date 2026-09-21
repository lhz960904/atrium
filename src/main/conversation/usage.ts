import type { Db } from '@main/db';
import type { TokenRates } from '@shared/cost';
import { type SQL, sql } from 'drizzle-orm';

/**
 * What every model call cost, read back out of the conversations themselves.
 *
 * There is no separate ledger. A run writes a usage record beside each turn and
 * beside each call made on the thread's behalf, carrying the provider's own
 * price; these reports aggregate those records, so the page can never disagree
 * with the conversation it is summing.
 *
 * Nothing is indexed by time — every index pi ships on `records` is prefixed by
 * `session_id` — so the range is narrowed by the threads instead: a run always
 * touches its thread, so a thread untouched since the range began cannot hold
 * spend inside it. Adding an index on `records(timestamp)` was measured and is
 * not worth it: the work is the `json_extract` on each matching row, not
 * finding the rows.
 */

export const USAGE_RANGES = ['7d', '30d', 'month', 'year', 'all'] as const;
/** Period the usage page aggregates over; `year` also drives the heatmap. */
export type UsageRange = (typeof USAGE_RANGES)[number];

/** Resolves a model's current rates — for the one question a bill can't answer. */
export type RatesResolver = (providerId: string, modelId: string) => TokenRates;

/** Inclusive lower bound (ms) for a range. */
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

/**
 * Every priced call in the range, one row each.
 *
 * A turn's own record names the entry it belongs to and the model is read off
 * that turn; a call made beside the run — a title, a summary, a review, a
 * subagent — has no turn of its own and carries its model in `details`, which
 * is also where its kind comes from. Deleted threads are deliberately not
 * excluded: their rows are what makes last month's total stay last month's.
 */
function calls(start: number): SQL {
  return sql`
    SELECT r.timestamp AS at,
           COALESCE(json_extract(r.payload, '$.details.kind'), 'chat') AS kind,
           COALESCE(
             json_extract(r.payload, '$.details.providerId'),
             json_extract(e.payload, '$.message.provider')
           ) AS "providerId",
           COALESCE(
             json_extract(r.payload, '$.details.modelId'),
             json_extract(e.payload, '$.message.model')
           ) AS "modelId",
           COALESCE(json_extract(r.payload, '$.usage.input'), 0) AS input,
           COALESCE(json_extract(r.payload, '$.usage.output'), 0) AS output,
           COALESCE(json_extract(r.payload, '$.usage.cacheRead'), 0) AS "cacheRead",
           COALESCE(json_extract(r.payload, '$.usage.cacheWrite'), 0) AS "cacheWrite",
           COALESCE(json_extract(r.payload, '$.usage.totalTokens'), 0) AS "totalTokens",
           COALESCE(json_extract(r.payload, '$.usage.cost.total'), 0) AS "costUsd"
    FROM records r
    LEFT JOIN entries e
      ON e.session_id = r.session_id AND e.id = json_extract(r.payload, '$.entryId')
    WHERE r.type = 'usage'
      AND r.timestamp >= ${start}
      AND r.session_id IN (
        SELECT session_id FROM threads WHERE session_id IS NOT NULL AND updated_at >= ${start}
      )`;
}

type SummaryRow = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  calls: number;
  chatCalls: number;
  subagentCalls: number;
};
type ModelRow = { providerId: string | null; modelId: string | null; cacheRead: number };
type DayRow = { day: string; tokens: number; costUsd: number };
type DayModelRow = { day: string; modelId: string | null; tokens: number; costUsd: number };

/** Headline totals for the period's stat cards, including estimated cache savings. */
export function usageSummary(db: Db, range: UsageRange, ratesOf: RatesResolver) {
  const start = rangeStartMs(range);
  const totals = (
    db.all(sql`
      SELECT COALESCE(SUM("totalTokens"), 0) AS "totalTokens",
             COALESCE(SUM(input), 0) AS "inputTokens",
             COALESCE(SUM(output), 0) AS "outputTokens",
             COALESCE(SUM("cacheRead"), 0) AS "cacheReadTokens",
             COALESCE(SUM("cacheWrite"), 0) AS "cacheCreationTokens",
             COALESCE(SUM("costUsd"), 0) AS "costUsd",
             COUNT(*) AS "calls",
             COALESCE(SUM(kind = 'chat'), 0) AS "chatCalls",
             COALESCE(SUM(kind = 'subagent'), 0) AS "subagentCalls"
      FROM (${calls(start)})`) as SummaryRow[]
  )[0];

  // Estimated cache savings: each cache-read token would have cost the full
  // input rate; it was billed at the (much cheaper) cache-read rate instead.
  // The only figure here priced from rates, because no bill states it.
  const byModel = db.all(sql`
    SELECT "providerId", "modelId", COALESCE(SUM("cacheRead"), 0) AS "cacheRead"
    FROM (${calls(start)})
    WHERE "cacheRead" > 0
    GROUP BY "providerId", "modelId"`) as ModelRow[];
  let cacheSavedUsd = 0;
  for (const model of byModel) {
    if (!model.providerId || !model.modelId) continue;
    const rates = ratesOf(model.providerId, model.modelId);
    cacheSavedUsd += Number(model.cacheRead) * Math.max(0, rates.input - rates.cacheRead);
  }

  const inputTokens = Number(totals.inputTokens);
  const cacheReadTokens = Number(totals.cacheReadTokens);
  return {
    totalCostUsd: Number(totals.costUsd),
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

/** Per-day tokens and cost. The bar chart passes the period; the heatmap `year`. */
export function usageDaily(db: Db, range: UsageRange) {
  const rows = db.all(sql`
    SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime') AS "day",
           COALESCE(SUM("totalTokens"), 0) AS "tokens",
           COALESCE(SUM("costUsd"), 0) AS "costUsd"
    FROM (${calls(rangeStartMs(range))})
    GROUP BY "day" ORDER BY "day"`) as DayRow[];
  return rows.map((row) => ({
    date: row.day,
    tokens: Number(row.tokens),
    costUsd: Number(row.costUsd),
  }));
}

/**
 * Per-day, per-model tokens and cost for the stacked "by model" bar view.
 * Long format (one row per day×model); the frontend pivots it. `models` is
 * sorted by total cost desc so the chart's bar order and legend stay stable.
 */
export function usageDailyByModel(db: Db, range: UsageRange) {
  const raw = db.all(sql`
    SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime') AS "day",
           "modelId",
           COALESCE(SUM("totalTokens"), 0) AS "tokens",
           COALESCE(SUM("costUsd"), 0) AS "costUsd"
    FROM (${calls(rangeStartMs(range))})
    GROUP BY "day", "modelId" ORDER BY "day"`) as DayModelRow[];
  const rows = raw.flatMap((row) =>
    row.modelId
      ? [
          {
            date: row.day,
            modelId: row.modelId,
            tokens: Number(row.tokens),
            costUsd: Number(row.costUsd),
          },
        ]
      : [],
  );
  const costByModel = new Map<string, number>();
  for (const row of rows) {
    costByModel.set(row.modelId, (costByModel.get(row.modelId) ?? 0) + row.costUsd);
  }
  const models = [...costByModel.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
  return { models, rows };
}
