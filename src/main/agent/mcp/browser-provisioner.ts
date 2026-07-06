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

/** Reconcile the managed public-browsing server with the master toggle: connect
 *  it when browser control is on, tear it down when off. */
export async function syncBrowserProvisioning(enabled: boolean): Promise<void> {
  await mcpManager.setManaged(PUBLIC_BROWSER_ID, enabled ? publicBrowserServer() : null);
}
