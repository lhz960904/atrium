import { isChromeInstalled } from '../../browser/detect';
import { getSettings } from '../../settings/conf';
import type { ResolvedMcpServer } from './config';
import { mcpManager } from './manager';

/*
 * Atrium provisions the browser MCP server itself, as a managed server the
 * manager connects like any other — but its definition never touches the DB, so
 * it stays out of the MCP settings list (the user manages it from Settings →
 * Browser instead). Tracks @latest rather than a pin so it moves with the
 * auto-updating browser extension the signed-in server connects to later.
 */
const PLAYWRIGHT_MCP = '@playwright/mcp@latest';

/** Stable id for the managed public-browsing server. */
export const PUBLIC_BROWSER_ID = 'atrium:browser';

/**
 * Public browsing: the agent drives a fresh, login-less browser, never the
 * user's everyday profile. No `--browser` is passed, so playwright-mcp uses its
 * default — the installed Chrome (its "chrome" channel) with a throwaway
 * `--isolated` profile — which is why it launches the user's real Chrome rather
 * than downloading a separate Chromium. Spawned via npx, so it needs Node on
 * PATH (resolved from the login shell at startup); if Node or Chrome is missing
 * the server just fails to connect and the capability reads as unavailable
 * rather than breaking anything.
 */
function publicBrowserServer(): ResolvedMcpServer {
  return {
    id: PUBLIC_BROWSER_ID,
    name: 'browser',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', PLAYWRIGHT_MCP, '--isolated'],
    env: {},
    envPassthrough: [],
  };
}

/** Whether the public browser should be running: the user hasn't turned browser
 *  control off AND Chrome is installed for it to launch. A missing Chrome keeps
 *  it torn down (rather than spawning a server doomed to fail on first navigate),
 *  which is what makes the feature default to off when Chrome isn't present. */
export function shouldRunPublicBrowser(): boolean {
  return getSettings('browser').enabled && isChromeInstalled();
}

/** Reconcile the managed public-browsing server with the current state: connect
 *  it when browser control is on and Chrome is present, tear it down otherwise.
 *  Call after the toggle changes or Chrome availability may have shifted. */
export async function syncBrowserProvisioning(): Promise<void> {
  await mcpManager.setManaged(
    PUBLIC_BROWSER_ID,
    shouldRunPublicBrowser() ? publicBrowserServer() : null,
  );
}
