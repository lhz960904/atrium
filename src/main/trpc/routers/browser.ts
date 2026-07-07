import { syncBrowserProvisioning } from '../../agent/mcp/browser-provisioner';
import { isChromeInstalled } from '../../browser/detect';
import { getSettings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

export const browserRouter = router({
  /** State for the Browser settings section: whether Chrome is installed (gates
   *  the whole feature) and whether the signed-in browser has been connected. */
  environment: publicProcedure.query(() => {
    const s = getSettings('browser');
    return { chromeInstalled: isChromeInstalled(), connected: s.connected };
  }),

  /** Connect the signed-in browser: mark connected and provision the --extension
   *  server. The extension prompts for approval ("Allow & select") on connect. */
  connect: publicProcedure.mutation(({ ctx }) => {
    getSettings().set('browser', { ...getSettings('browser'), connected: true });
    void syncBrowserProvisioning(ctx.db);
  }),

  /** Disconnect the signed-in browser: tear its --extension server down. */
  disconnect: publicProcedure.mutation(({ ctx }) => {
    getSettings().set('browser', { ...getSettings('browser'), connected: false });
    void syncBrowserProvisioning(ctx.db);
  }),
});
