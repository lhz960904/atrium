import { ratesFor } from '@main/agent/providers/models';
import { USAGE_RANGES, usageDaily, usageDailyByModel, usageSummary } from '@main/db/usage';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const RANGE = z.enum(USAGE_RANGES).default('month');

export const usageRouter = router({
  summary: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ ctx, input }) =>
      usageSummary(ctx.db, input.range, (providerId, modelId) =>
        ratesFor(ctx.db, providerId, modelId),
      ),
    ),

  daily: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ ctx, input }) => usageDaily(ctx.db, input.range)),

  dailyByModel: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ ctx, input }) => usageDailyByModel(ctx.db, input.range)),
});
