import { ratesFor } from '@main/agent/providers/models';
import {
  USAGE_RANGES,
  usageDaily,
  usageDailyByModel,
  usageSummary,
} from '@main/conversation/usage';
import { getDb } from '@main/db';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const RANGE = z.enum(USAGE_RANGES).default('month');

export const usageRouter = router({
  summary: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ input }) =>
      usageSummary(getDb(), input.range, (providerId, modelId) =>
        ratesFor(getDb(), providerId, modelId),
      ),
    ),

  daily: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ input }) => usageDaily(getDb(), input.range)),

  dailyByModel: publicProcedure
    .input(z.object({ range: RANGE }))
    .query(({ input }) => usageDailyByModel(getDb(), input.range)),
});
