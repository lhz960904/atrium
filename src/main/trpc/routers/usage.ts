import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { modelPricing } from '../../agent/models/catalog';
import { publicProcedure, router } from '../trpc';

/** Period the usage page aggregates over; `year` also drives the heatmap. */
const RANGE = z.enum(['7d', '30d', 'month', 'year', 'all']).default('month');
type Range = z.infer<typeof RANGE>;

/** Inclusive lower bound (ms) for a range; rows are filtered on created_at. */
function rangeStartMs(range: Range): number {
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
type ModelRow = { modelId: string; cacheRead: number };
type DayRow = { day: string; tokens: number; costMicros: number };
type DayModelRow = { day: string; modelId: string; tokens: number; costMicros: number };

export const usageRouter = router({
  /** Headline totals for the period's stat cards (incl. estimated cache savings). */
  summary: publicProcedure.input(z.object({ range: RANGE })).query(({ ctx, input }) => {
    const start = rangeStartMs(input.range);
    const s = (
      ctx.db.all(sql`
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
    const byModel = ctx.db.all(sql`
      SELECT model_id AS "modelId", COALESCE(SUM(cache_read_tokens), 0) AS "cacheRead"
      FROM usage WHERE created_at >= ${start} AND cache_read_tokens > 0
      GROUP BY model_id`) as ModelRow[];
    let cacheSavedUsd = 0;
    for (const m of byModel) {
      const p = modelPricing(m.modelId);
      cacheSavedUsd += Number(m.cacheRead) * Math.max(0, p.input - p.cacheRead);
    }

    const inputTokens = Number(s.inputTokens);
    const cacheReadTokens = Number(s.cacheReadTokens);
    return {
      totalCostUsd: Number(s.costMicros) / 1e6,
      totalTokens: Number(s.totalTokens),
      inputTokens,
      outputTokens: Number(s.outputTokens),
      cacheReadTokens,
      cacheCreationTokens: Number(s.cacheCreationTokens),
      calls: Number(s.calls),
      chatCalls: Number(s.chatCalls),
      subagentCalls: Number(s.subagentCalls),
      cacheSavedUsd,
      cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
    };
  }),

  /** Per-day tokens + cost. Bar chart passes the period; heatmap passes `year`. */
  daily: publicProcedure.input(z.object({ range: RANGE })).query(({ ctx, input }) => {
    const start = rangeStartMs(input.range);
    const rows = ctx.db.all(sql`
      SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS "day",
             COALESCE(SUM(total_tokens), 0) AS "tokens",
             COALESCE(SUM(cost_usd_micros), 0) AS "costMicros"
      FROM usage WHERE created_at >= ${start}
      GROUP BY day ORDER BY day`) as DayRow[];
    return rows.map((r) => ({
      date: r.day,
      tokens: Number(r.tokens),
      costUsd: Number(r.costMicros) / 1e6,
    }));
  }),

  /**
   * Per-day, per-model tokens + cost for the grouped/stacked "by model" bar
   * view. Long format (one row per day×model); the frontend pivots it. `models`
   * is sorted by total cost desc so the chart's bar order + legend stay stable.
   */
  dailyByModel: publicProcedure.input(z.object({ range: RANGE })).query(({ ctx, input }) => {
    const start = rangeStartMs(input.range);
    const raw = ctx.db.all(sql`
      SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS "day",
             model_id AS "modelId",
             COALESCE(SUM(total_tokens), 0) AS "tokens",
             COALESCE(SUM(cost_usd_micros), 0) AS "costMicros"
      FROM usage WHERE created_at >= ${start}
      GROUP BY day, model_id ORDER BY day`) as DayModelRow[];
    const rows = raw.map((r) => ({
      date: r.day,
      modelId: r.modelId,
      tokens: Number(r.tokens),
      costUsd: Number(r.costMicros) / 1e6,
    }));
    const costByModel = new Map<string, number>();
    for (const r of rows) costByModel.set(r.modelId, (costByModel.get(r.modelId) ?? 0) + r.costUsd);
    const models = [...costByModel.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    return { models, rows };
  }),
});
