import { updaterManager } from '../../updater';
import { publicProcedure, router } from '../trpc';

/**
 * Update controls. The mutations only kick the action — every resulting
 * transition (checking → available → downloading → downloaded / error) reaches
 * the renderer through the `update:state` broadcast, so a fresh mount seeds from
 * `getState` and then follows live. `check`/`download` are fire-and-forget: a
 * download runs for as long as the package takes, so the request must not block.
 */
export const updateRouter = router({
  getState: publicProcedure.query(() => updaterManager.getState()),

  check: publicProcedure.mutation(() => {
    void updaterManager.check();
  }),

  download: publicProcedure.mutation(() => {
    void updaterManager.download();
  }),

  install: publicProcedure.mutation(() => {
    updaterManager.install();
  }),
});
