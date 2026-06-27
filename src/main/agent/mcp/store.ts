import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { mcpServers } from '../../db/schema';
import { createLogger } from '../../log';
import { type ResolvedMcpServer, resolveMcpServer } from './config';
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
