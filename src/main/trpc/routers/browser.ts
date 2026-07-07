import { spawn } from 'node:child_process';
import { clipboard } from 'electron';
import { z } from 'zod';
import { syncBrowserProvisioning } from '../../agent/mcp/browser-provisioner';
import { isChromeInstalled, isPlaywrightExtensionInstalled } from '../../browser/detect';
import { getSettings } from '../../settings/conf';
import { publicProcedure, router } from '../trpc';

const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
// The extension's copy button puts exactly `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>`
// on the clipboard; matching that format means we only ever pick up the token and
// never mistake unrelated clipboard content for it.
const TOKEN_RE = /^PLAYWRIGHT_MCP_EXTENSION_TOKEN=([A-Za-z0-9_-]+)$/;

/** Pull the extension token off the clipboard, or null if it doesn't hold one. */
function clipboardTokenValue(): string | null {
  const match = clipboard.readText().trim().match(TOKEN_RE);
  return match ? match[1] : null;
}

/** Open a URL in Chrome specifically (chrome-extension:// pages only load there). */
function openInChrome(url: string): void {
  if (process.platform === 'darwin')
    spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore' });
  else if (process.platform === 'win32')
    spawn('cmd', ['/c', 'start', '', 'chrome', url], { stdio: 'ignore' });
  else spawn('google-chrome', [url], { stdio: 'ignore' });
}

export const browserRouter = router({
  /** State for the Browser settings section. Polled by the UI, so installing
   *  Chrome/the extension or connecting shows up live without a manual refresh. */
  environment: publicProcedure.query(() => {
    const s = getSettings('browser');
    return {
      chromeInstalled: isChromeInstalled(),
      extensionInstalled: isPlaywrightExtensionInstalled(),
      connected: s.connected,
      hasToken: Boolean(s.extensionToken),
    };
  }),

  /** Peek at the clipboard for the extension token — read-only, so the UI can
   *  poll it while waiting for the user to copy and react the moment they do.
   *  `text` (capped) lets the UI tell a fresh copy from the pre-existing content
   *  and flag a copy that isn't a token. */
  clipboardToken: publicProcedure.query(() => {
    const text = clipboard.readText().trim();
    return { token: text.match(TOKEN_RE)?.[1] ?? null, text: text.slice(0, 512) };
  }),

  /** Open the extension's status page, where the token + a copy button live. */
  openTokenPage: publicProcedure.mutation(() => {
    openInChrome(`chrome-extension://${EXTENSION_ID}/status.html`);
  }),

  /** Store the extension token (passed in, or read off the clipboard) and mark
   *  connected, then re-provision so the --extension server reconnects silently.
   *  Only the exact token format is accepted, so unrelated content is ignored. */
  importToken: publicProcedure
    .input(z.object({ token: z.string().optional() }).optional())
    .mutation(({ ctx, input }) => {
      const token = input?.token ?? clipboardTokenValue();
      if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return { imported: false as const };
      getSettings().set('browser', {
        ...getSettings('browser'),
        extensionToken: token,
        connected: true,
      });
      void syncBrowserProvisioning(ctx.db);
      return { imported: true as const };
    }),

  /** Connect the signed-in browser without a token: the extension prompts for
   *  approval ("Allow & select") on first use. */
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
});
