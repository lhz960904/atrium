import { z } from 'zod';
import { DEFAULTS, getSettings, type Settings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

/**
 * Expose the electron-conf settings store to the renderer over tRPC.
 *
 * The renderer never imports `electron-conf` directly — all reads / writes
 * funnel through these procedures so the on-disk format and migration
 * logic stay on the main side.
 */
export const settingsRouter = router({
  /** Snapshot of every settings field (with defaults filled in). */
  all: publicProcedure.query((): Required<Settings> => {
    const conf = getSettings();
    return {
      hasCompletedWelcome: conf.get('hasCompletedWelcome', DEFAULTS.hasCompletedWelcome),
    };
  }),

  setHasCompletedWelcome: publicProcedure.input(z.boolean()).mutation(({ input }) => {
    getSettings().set('hasCompletedWelcome', input);
  }),
});
