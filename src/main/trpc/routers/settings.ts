import { z } from 'zod';
import { DEFAULTS, getSettings, type SelectedModel } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

export const settingsRouter = router({
  /** The persisted default chat model, or null if none chosen yet. */
  selectedModel: publicProcedure.query((): SelectedModel | null => {
    return getSettings().get('selectedModel', DEFAULTS.selectedModel);
  }),

  setSelectedModel: publicProcedure
    .input(z.object({ providerId: z.string(), modelId: z.string() }))
    .mutation(({ input }) => {
      getSettings().set('selectedModel', input);
    }),
});
