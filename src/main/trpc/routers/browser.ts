import { randomBytes } from 'node:crypto';
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

  /** Connect the signed-in browser: mint a stable extension token on first use,
   *  mark connected, and provision the --extension server. */
  connect: publicProcedure.mutation(({ ctx }) => {
    const s = getSettings('browser');
    const extensionToken = s.extensionToken || randomBytes(24).toString('base64url');
    getSettings().set('browser', { ...s, connected: true, extensionToken });
    void syncBrowserProvisioning(ctx.db);
  }),

  /** Disconnect the signed-in browser: tear its server down; the token is kept
   *  so a later reconnect stays silent. */
  disconnect: publicProcedure.mutation(({ ctx }) => {
    getSettings().set('browser', { ...getSettings('browser'), connected: false });
    void syncBrowserProvisioning(ctx.db);
  }),
});
