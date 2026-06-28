import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { createLogger } from '../../log';
import { decryptCredentials, encryptCredentials } from '../../providers/credentials';
import { type ResolvedMcpServer, resolveMcpServer } from './config';
import type { McpOAuthState, McpOAuthStore } from './oauth';
import { decryptSecrets } from './secrets';

const log = createLogger('mcp');

/** Load enabled MCP servers from the DB, config-validated and with secrets merged in. */
export function loadEnabledServers(db: Db): ResolvedMcpServer[] {
  const rows = db.select().from(mcpServers).where(eq(mcpServers.enabled, true)).all();
  const servers: ResolvedMcpServer[] = [];
  for (const row of rows) {
    try {
      servers.push(resolveMcpServer(row, decryptSecrets(row.credentialsEncrypted)));
    } catch (err) {
      log.error(`skipping misconfigured MCP server "${row.name}":`, err);
    }
  }
  return servers;
}

/** Resolve a single server by id (config-validated, secrets merged), or null. */
export function resolveServerById(db: Db, id: string): ResolvedMcpServer | null {
  const row = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  return row ? resolveMcpServer(row, decryptSecrets(row.credentialsEncrypted)) : null;
}

/** DB-backed, safeStorage-encrypted OAuth state for one server (kept out of the
 *  credentials blob so config edits don't clobber the tokens). */
export function oauthStore(db: Db, id: string): McpOAuthStore {
  return {
    load(): McpOAuthState {
      const row = db
        .select({ blob: mcpServers.oauthEncrypted })
        .from(mcpServers)
        .where(eq(mcpServers.id, id))
        .get();
      return row?.blob ? decryptCredentials<McpOAuthState>(row.blob) : {};
    },
    save(state: McpOAuthState): void {
      const hasAny = Boolean(state.clientInformation || state.tokens);
      db.update(mcpServers)
        .set({ oauthEncrypted: hasAny ? encryptCredentials(state) : null, updatedAt: new Date() })
        .where(eq(mcpServers.id, id))
        .run();
    },
  };
}
