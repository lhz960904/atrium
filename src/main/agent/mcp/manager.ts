import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Db } from '../../db';
import { createLogger } from '../../log';
import { buildCatalog, type McpToolEntry } from './catalog';
import type { ResolvedMcpServer } from './config';
import { httpHeaders, McpConnection } from './connection';
import { runInteractiveOAuth } from './oauth';
import { loadEnabledServers, oauthStore, resolveServerById } from './store';

const log = createLogger('mcp');

/** Live per-server connection status, surfaced to the settings UI. */
export type McpServerStatus = 'connected' | 'needs-auth' | 'error';

/**
 * Process-wide registry of connected MCP servers. Connects enabled servers,
 * aggregates their tools into one uniquely-named catalog, and routes calls back
 * to the owning server. A server that fails to connect is logged and skipped —
 * it never blocks the others.
 */
export class McpManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly statuses = new Map<string, McpServerStatus>();
  private readonly pendingAuth = new Map<string, AbortController>();
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
      this.statuses.set(server.id, 'connected');
      log.info(`connected "${server.name}" (${conn.listTools().length} tools)`);
    } catch (err) {
      // Needs-auth is an expected state (no tokens yet → user clicks Authenticate),
      // not a failure — log it quietly without the stack; reserve error for real faults.
      if (err instanceof UnauthorizedError) {
        this.statuses.set(server.id, 'needs-auth');
        log.info(`"${server.name}" needs authorization`);
      } else {
        this.statuses.set(server.id, 'error');
        log.error(`failed to connect "${server.name}":`, err);
      }
    }
  }

  async disconnect(serverId: string): Promise<void> {
    // Cancel an in-flight auth so deleting/disabling a server doesn't leave the
    // browser flow hanging until its timeout.
    this.pendingAuth.get(serverId)?.abort();
    this.pendingAuth.delete(serverId);
    this.statuses.delete(serverId);
    const conn = this.connections.get(serverId);
    if (!conn) return;
    this.connections.delete(serverId);
    await conn.close();
  }

  /** Live status per server id (only servers we've attempted to connect). */
  serverStatuses(): Record<string, McpServerStatus> {
    return Object.fromEntries(this.statuses);
  }

  /** Reconnect a server by id after its config changed, or drop it if now disabled. */
  async reload(id: string): Promise<void> {
    await this.disconnect(id);
    const server = this.db ? resolveServerById(this.db, id) : null;
    if (server?.enabled) await this.connect(server);
  }

  /** Run the interactive OAuth flow for an http server, then reconnect with the tokens. */
  async authenticate(id: string): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('MCP manager not initialized');
    const server = resolveServerById(db, id);
    if (!server || server.transport === 'stdio') {
      throw new Error('OAuth is only available for HTTP MCP servers');
    }
    const { shell } = require('electron') as typeof import('electron');
    const abort = new AbortController();
    this.pendingAuth.set(id, abort);
    try {
      await runInteractiveOAuth(
        server.url,
        { headers: httpHeaders(server) },
        oauthStore(db, id),
        (url) => void shell.openExternal(url),
        abort.signal,
      );
    } catch (err) {
      // Deleting/disabling the server aborts this flow (disconnect signals it); that,
      // or the server being gone now, makes the error moot — swallow it. Real failures
      // (timeout, auth error) on a still-present server surface to the UI.
      if (abort.signal.aborted || !resolveServerById(db, id)?.enabled) {
        log.info(`auth for "${server.name}" abandoned`);
        return;
      }
      throw err;
    } finally {
      this.pendingAuth.delete(id);
    }
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
