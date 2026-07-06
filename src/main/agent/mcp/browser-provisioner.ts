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
 * Public browsing: the agent drives a fresh, isolated browser — no login, never
 * the user's everyday profile. No `--browser` is forced, so Playwright picks its
 * own default rather than assuming the user runs Chrome. Spawned via npx, so it
 * needs Node on PATH (resolved from the login shell at startup); when Node or a
 * launchable browser is missing the server simply fails to connect and the
 * capability reads as unavailable rather than breaking anything.
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
