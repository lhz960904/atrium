import { eq } from 'drizzle-orm';
import { isChromeInstalled } from '../../browser/detect';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { createLogger } from '../../log';
import { getSettings } from '../../settings/conf';
import { mcpManager } from './manager';
import { encryptSecrets } from './secrets';

const log = createLogger('mcp');

/*
 * The browser feature provisions its MCP servers as normal `mcp_servers` rows
 * flagged `managed`, so they flow through the same store/manager/list path as
 * user servers — no special-casing in the manager, and the settings list shows
 * them read-only under "From plugins". Tracks @latest so it moves with the
 * auto-updating browser extension.
 */
const PLAYWRIGHT_MCP = '@playwright/mcp@latest';

/** Fixed ids/names for the two managed rows. Public = the agent's own login-less
 *  browser; signed-in = the user's Chrome via the extension bridge. */
const PUBLIC_ID = 'atrium-browser';
const SIGNED_IN_ID = 'atrium-browser-login';

/** Upsert (when it should run) or delete a managed browser row. Secret env (the
 *  extension token) is stored encrypted, like any server credential; passing an
 *  empty map clears it. */
function reconcileRow(
  db: Db,
  id: string,
  name: string,
  run: boolean,
  args: string[],
  secretEnv: Record<string, string> = {},
): void {
  try {
    if (!run) {
      db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
      return;
    }
    const now = new Date();
    const config = { command: 'npx', args, env: {}, envPassthrough: [] };
    const credentialsEncrypted =
      Object.keys(secretEnv).length > 0 ? encryptSecrets({ env: secretEnv }) : null;
    db.insert(mcpServers)
      .values({
        id,
        name,
        enabled: true,
        managed: true,
        transport: 'stdio',
        config,
        credentialsEncrypted,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mcpServers.id,
        set: {
          enabled: true,
          managed: true,
          transport: 'stdio',
          config,
          credentialsEncrypted,
          updatedAt: now,
        },
      })
      .run();
  } catch (err) {
    // Most likely the name collides with a user server; leave it be.
    log.warn(`could not reconcile managed browser server "${name}":`, err);
  }
}

/**
 * Reconcile both managed browser rows with the current state, then reload the
 * manager so connections and the agent's tools follow. Call at startup, on the
 * toggle, on connect/disconnect, or when Chrome availability may have shifted.
 *
 * Public browsing drives a fresh, login-less browser (no `--browser`, so
 * playwright-mcp's default installed Chrome, `--isolated`); it runs whenever
 * control is on and Chrome is present. Signed-in browsing (`--extension`) also
 * needs the user to have connected; when the extension token has been imported
 * it's passed so reconnects skip the approval dialog, otherwise the extension
 * prompts ("Allow & select") on connect.
 */
export async function syncBrowserProvisioning(db: Db): Promise<void> {
  const s = getSettings('browser');
  const chrome = isChromeInstalled();
  reconcileRow(db, PUBLIC_ID, 'browser', s.enabled && chrome, ['-y', PLAYWRIGHT_MCP, '--isolated']);
  reconcileRow(
    db,
    SIGNED_IN_ID,
    'browser-login',
    s.enabled && chrome && s.connected,
    ['-y', PLAYWRIGHT_MCP, '--extension'],
    s.extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: s.extensionToken } : {},
  );
  await mcpManager.reload(PUBLIC_ID);
  await mcpManager.reload(SIGNED_IN_ID);
}
