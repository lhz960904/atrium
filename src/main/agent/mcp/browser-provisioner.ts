import { eq } from 'drizzle-orm';
import { isChromeInstalled } from '../../browser/detect';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { createLogger } from '../../log';
import { getSettings } from '../../settings/conf';
import { mcpManager } from './manager';

const log = createLogger('mcp');

/*
 * The browser feature provisions its MCP server as a normal `mcp_servers` row
 * flagged `managed`, so it flows through the exact same store/manager path as a
 * user server — no special-casing in the manager. Being managed, the MCP
 * settings list shows it read-only (no edit/toggle/delete). Tracks @latest so it
 * moves with the auto-updating browser extension the signed-in server uses later.
 */
const PLAYWRIGHT_MCP = '@playwright/mcp@latest';

/** Fixed id/name for the managed public-browsing row. */
const BROWSER_SERVER_ID = 'atrium-browser';
const BROWSER_SERVER_NAME = 'browser';

/** Whether the public browser should run: browser control is on AND Chrome is
 *  installed to launch (playwright-mcp's default channel). A missing Chrome keeps
 *  the row absent rather than spawning a server doomed to fail on first navigate. */
export function shouldRunPublicBrowser(): boolean {
  return getSettings('browser').enabled && isChromeInstalled();
}

/**
 * Reconcile the managed public-browsing server row with the current state, then
 * reload the manager so its connection and the agent's browser tools follow.
 * Call at startup, when the toggle changes, or when Chrome availability may have.
 * Public browsing drives a fresh, login-less browser: no `--browser` is passed,
 * so playwright-mcp uses its default (the installed Chrome), with an `--isolated`
 * throwaway profile.
 */
export async function syncBrowserProvisioning(db: Db): Promise<void> {
  try {
    if (shouldRunPublicBrowser()) {
      const now = new Date();
      const config = {
        command: 'npx',
        args: ['-y', PLAYWRIGHT_MCP, '--isolated'],
        env: {},
        envPassthrough: [],
      };
      db.insert(mcpServers)
        .values({
          id: BROWSER_SERVER_ID,
          name: BROWSER_SERVER_NAME,
          enabled: true,
          managed: true,
          transport: 'stdio',
          config,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: mcpServers.id,
          set: { enabled: true, managed: true, transport: 'stdio', config, updatedAt: now },
        })
        .run();
    } else {
      db.delete(mcpServers).where(eq(mcpServers.id, BROWSER_SERVER_ID)).run();
    }
  } catch (err) {
    // Most likely the name is already taken by a user server; leave that be.
    log.warn('could not reconcile the managed browser server:', err);
  }
  await mcpManager.reload(BROWSER_SERVER_ID);
}
