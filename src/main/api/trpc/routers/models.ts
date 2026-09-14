import { modelRates, resolvePiModel } from '@main/agent/providers/models';
import type { TokenRates } from '@shared/cost';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

/**
 * Per-model context window + token rates for the renderer's token counter.
 * Cost is computed client-side from each message's stored token breakdown, so
 * the renderer asks about every model a thread actually used.
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
    .query(({ ctx, input }) => {
      const out: Record<string, { maxContextTokens: number; pricing: TokenRates }> = {};
      for (const { providerId, modelId } of input.models) {
        try {
          const model = resolvePiModel(ctx.db, providerId, modelId);
          out[`${providerId}/${modelId}`] = {
            maxContextTokens: model.contextWindow,
            pricing: modelRates(model),
          };
        } catch {
          // An unknown provider or a model that can't be resolved has no
          // window and no price to report; the counter degrades to tokens only.
        }
      }
      return out;
    }),
});
