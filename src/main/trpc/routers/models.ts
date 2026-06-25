import { z } from 'zod';
import { maxContextTokens, modelPricing } from '../../agent/models/catalog';
import { publicProcedure, router } from '../trpc';

/**
 * Per-model context window + token pricing for the renderer's token counter.
 * Cost is computed client-side from each message's stored token breakdown, so
 * the renderer asks for the rates of every model a thread actually used (pricing
 * lives here because the litellm catalog is refreshed in the main process).
 */
export const modelsRouter = router({
  info: publicProcedure.input(z.object({ modelIds: z.array(z.string()) })).query(({ input }) => {
    const out: Record<
      string,
      { maxContextTokens: number; pricing: ReturnType<typeof modelPricing> }
    > = {};
    for (const id of input.modelIds) {
      out[id] = { maxContextTokens: maxContextTokens(id), pricing: modelPricing(id) };
    }
    return out;
  }),
});
