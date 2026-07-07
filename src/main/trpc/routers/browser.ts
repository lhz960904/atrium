import { spawn } from 'node:child_process';
import { clipboard } from 'electron';
import { syncBrowserProvisioning } from '../../agent/mcp/browser-provisioner';
import { isChromeInstalled, isPlaywrightExtensionInstalled } from '../../browser/detect';
import { getSettings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
// The extension's copy button puts exactly `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>`
// on the clipboard; matching that format means we only ever pick up the token and
// never mistake unrelated clipboard content for it.
const TOKEN_RE = /^PLAYWRIGHT_MCP_EXTENSION_TOKEN=([A-Za-z0-9_-]+)$/;

/** Open a URL in Chrome specifically (chrome-extension:// pages only load there). */
function openInChrome(url: string): void {
  if (process.platform === 'darwin')
    spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore' });
  else if (process.platform === 'win32')
    spawn('cmd', ['/c', 'start', '', 'chrome', url], { stdio: 'ignore' });
  else spawn('google-chrome', [url], { stdio: 'ignore' });
}

export const browserRouter = router({
  /** State for the Browser settings section: whether Chrome is installed (gates
   *  the whole feature), whether the extension is installed (gates connect),
   *  whether the signed-in browser is connected, and whether the extension token
   *  has been imported (silent reconnect). */
  environment: publicProcedure.query(() => {
    const s = getSettings('browser');
    return {
      chromeInstalled: isChromeInstalled(),
      extensionInstalled: isPlaywrightExtensionInstalled(),
      connected: s.connected,
      hasToken: Boolean(s.extensionToken),
    };
  }),

  /** Connect the signed-in browser: mark connected and provision the --extension
   *  server. The extension prompts for approval ("Allow & select") on connect
   *  unless a token has already been imported. */
  connect: publicProcedure.mutation(({ ctx }) => {
    getSettings().set('browser', { ...getSettings('browser'), connected: true });
    void syncBrowserProvisioning(ctx.db);
  }),

  /** Disconnect the signed-in browser: tear its --extension server down and clear
   *  the stored token, so it fully resets (a stale/invalid token can't linger and
   *  keep the extension rejecting the connection). Reconnecting re-imports it. */
  disconnect: publicProcedure.mutation(({ ctx }) => {
    getSettings().set('browser', {
      ...getSettings('browser'),
      connected: false,
      extensionToken: '',
    });
    void syncBrowserProvisioning(ctx.db);
  }),

  /** Open the extension's status page, where the token + a copy button live, so
   *  the user can copy it for import. */
  openTokenPage: publicProcedure.mutation(() => {
    openInChrome(`chrome-extension://${EXTENSION_ID}/status.html`);
  }),

  /** Import the token the user copied from the status page: read it off the
   *  clipboard (read-only, never written), accept only the exact token format,
   *  store it, and re-provision so the signed-in server reconnects silently. */
  importToken: publicProcedure.mutation(({ ctx }) => {
    const match = clipboard.readText().trim().match(TOKEN_RE);
    if (!match) return { imported: false as const };
    getSettings().set('browser', {
      ...getSettings('browser'),
      extensionToken: match[1],
      connected: true,
    });
    void syncBrowserProvisioning(ctx.db);
    return { imported: true as const };
  }),
});
