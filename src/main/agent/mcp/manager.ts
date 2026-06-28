import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Db } from '../../db';
import { createLogger } from '../../log';
import { buildCatalog, type McpToolEntry } from './catalog';
import type { ResolvedMcpServer } from './config';
import { httpHeaders, McpConnection } from './connection';
import { runInteractiveOAuth } from './oauth';
import { loadEnabledServers, oauthStore, resolveServerById } from './store';

const log = createLogger('mcp');

/**
 * Process-wide registry of connected MCP servers. Connects enabled servers,
 * aggregates their tools into one uniquely-named catalog, and routes calls back
 * to the owning server. A server that fails to connect is logged and skipped —
 * it never blocks the others.
 */
export class McpManager {
  private readonly connections = new Map<string, McpConnection>();
  private db: Db | null = null;

  async init(db: Db): Promise<void> {
    this.db = db;
    await Promise.allSettled(loadEnabledServers(db).map((s) => this.connect(s)));
  }

  private async connect(server: ResolvedMcpServer): Promise<void> {
    // HTTP/SSE servers get an OAuth store so the silent provider can use/refresh
    // saved tokens; stdio servers never authenticate.
    const store =
      this.db && server.transport !== 'stdio' ? oauthStore(this.db, server.id) : undefined;
    const conn = new McpConnection(server, store);
    try {
      await conn.connect();
      this.connections.set(server.id, conn);
      log.info(`connected "${server.name}" (${conn.listTools().length} tools)`);
    } catch (err) {
      log.error(`failed to connect "${server.name}":`, err);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    this.connections.delete(serverId);
    await conn.close();
  }

  /** Reconnect a server by id after its config changed, or drop it if now disabled. */
  async reload(id: string): Promise<void> {
    await this.disconnect(id);
    const server = this.db ? resolveServerById(this.db, id) : null;
    if (server?.enabled) await this.connect(server);
  }

  /** Run the interactive OAuth flow for an http server, then reconnect with the tokens. */
  async authenticate(id: string): Promise<void> {
    if (!this.db) throw new Error('MCP manager not initialized');
    const server = resolveServerById(this.db, id);
    if (!server || server.transport === 'stdio') {
      throw new Error('OAuth is only available for HTTP MCP servers');
    }
    const { shell } = require('electron') as typeof import('electron');
    await runInteractiveOAuth(
      server.url,
      { headers: httpHeaders(server) },
      oauthStore(this.db, id),
      (url) => void shell.openExternal(url),
    );
    await this.reload(id);
  }

  /** Every tool across the connected servers, uniquely named and ready to adapt. */
  catalog(): McpToolEntry[] {
    return buildCatalog(
      [...this.connections.values()].map((c) => ({
        id: c.id,
        name: c.name,
        tools: c.listTools(),
      })),
    );
  }

  callTool(
    serverId: string,
    rawName: string,
    args: Record<string, unknown>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CallToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} is not connected`);
    return conn.callTool(rawName, args, opts);
  }

  async dispose(): Promise<void> {
    const conns = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(conns.map((c) => c.close()));
  }
}

/** Single instance for the main process; wired into startup and getTools later. */
export const mcpManager = new McpManager();
