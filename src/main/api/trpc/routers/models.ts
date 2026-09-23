import { resolvePiModel } from '@main/agent/providers/models';
import { getDb } from '@main/db';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

/**
 * Per-model context window for the renderer's token counter. Rates are not
 * reported: what a turn cost rides on the turn itself, priced by the provider,
 * and a second figure derived here could only disagree with it.
 *
 * Keyed by provider *and* model: the same model id served by two providers is
 * two different products, with its own window and its own price. Answers come
 * from the same `Model` the engine streams with, so the gauge can never
 * disagree with what compaction budgets against.
 */
export const modelsRouter = router({
  info: publicProcedure
    .input(
      z.object({
        models: z.array(z.object({ providerId: z.string(), modelId: z.string() })).max(100),
      }),
    )
    .query(({ input }) => {
      const out: Record<string, { maxContextTokens: number }> = {};
      for (const { providerId, modelId } of input.models) {
        try {
          const model = resolvePiModel(getDb(), providerId, modelId);
          out[`${providerId}/${modelId}`] = { maxContextTokens: model.contextWindow };
        } catch {
          // An unknown provider or a model that can't be resolved has no window
          // to report; the gauge degrades to a token count with no denominator.
        }
      }
      return out;
    }),
});
