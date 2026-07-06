import type { ResolvedMcpServer } from './config';
import { mcpManager } from './manager';

/*
 * Atrium provisions the browser MCP server itself, as a managed server the
 * manager connects like any other — but its definition never touches the DB, so
 * it stays out of the MCP settings list (the user manages it from Settings →
 * Browser instead). Pinned to a known @playwright/mcp so the tool surface stays
 * predictable across app updates; the signed-in server, added on connect later,
 * will pin the same version to stay compatible with the browser extension.
 */
const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.77';

/** Stable id for the managed public-browsing server. */
export const PUBLIC_BROWSER_ID = 'atrium:browser';

/**
 * Public browsing: the agent drives a fresh, isolated Chrome instance — no
 * login, never the user's everyday profile. Spawned via npx, so it needs Node on
 * PATH (resolved from the login shell at startup); when Node or Chrome is
 * missing the server simply fails to connect and the capability reads as
 * unavailable rather than breaking anything.
 */
function publicBrowserServer(): ResolvedMcpServer {
  return {
    id: PUBLIC_BROWSER_ID,
    name: 'browser',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', PLAYWRIGHT_MCP, '--browser', 'chrome', '--isolated'],
    env: {},
    envPassthrough: [],
  };
}

/** Reconcile the managed public-browsing server with the master toggle: connect
 *  it when browser control is on, tear it down when off. */
export async function syncBrowserProvisioning(enabled: boolean): Promise<void> {
  await mcpManager.setManaged(PUBLIC_BROWSER_ID, enabled ? publicBrowserServer() : null);
}
