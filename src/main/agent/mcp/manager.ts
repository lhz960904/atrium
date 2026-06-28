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

// Reconnect backoff after an unexpected drop: 1s, 2s, 4s … capped at 30s.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

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
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private db: Db | null = null;

  async init(db: Db): Promise<void> {
    this.db = db;
    await Promise.allSettled(loadEnabledServers(db).map((s) => this.connect(s)));
  }

  /**
   * Establish the connection: on success store it, mark connected, clear any
   * pending reconnect, and wire the drop handler. Throws on failure so callers
   * decide whether to classify-and-stop (initial connect) or back off (reconnect).
   */
  private async establish(server: ResolvedMcpServer): Promise<void> {
    // HTTP/SSE servers get an OAuth store so the silent provider can use/refresh
    // saved tokens; stdio servers never authenticate.
    const store =
      this.db && server.transport !== 'stdio' ? oauthStore(this.db, server.id) : undefined;
    const conn = new McpConnection(server, store, () => this.handleDrop(server.id));
    await conn.connect();
    this.connections.set(server.id, conn);
    this.statuses.set(server.id, 'connected');
    this.cancelReconnect(server.id);
    log.info(`connected "${server.name}" (${conn.listTools().length} tools)`);
  }

  /** Initial connect (startup / reload): a failure is classified and left as-is —
   *  only a drop after a successful connect starts the backoff reconnect loop. */
  private async connect(server: ResolvedMcpServer): Promise<void> {
    try {
      await this.establish(server);
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

  /** A live connection closed unexpectedly — drop it and start reconnecting. */
  private handleDrop(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return; // an intentional close already removed it
    this.connections.delete(id);
    this.statuses.set(id, 'error');
    log.info(`"${conn.name}" connection dropped; reconnecting`);
    this.scheduleReconnect(id, 0);
  }

  private scheduleReconnect(id: string, attempt: number): void {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(id);
      void this.reconnect(id, attempt);
    }, delay);
    this.reconnectTimers.set(id, timer);
  }

  private async reconnect(id: string, attempt: number): Promise<void> {
    const server = this.db ? resolveServerById(this.db, id) : null;
    if (!server?.enabled) return; // deleted or disabled while waiting → give up
    try {
      await this.establish(server);
      log.info(`reconnected "${server.name}"`);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        // Auth won't recover on its own — stop and wait for the user to re-auth.
        this.statuses.set(id, 'needs-auth');
        return;
      }
      this.statuses.set(id, 'error');
      this.scheduleReconnect(id, attempt + 1);
    }
  }

  private cancelReconnect(id: string): void {
    const timer = this.reconnectTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(id);
    }
  }

  async disconnect(serverId: string): Promise<void> {
    // Cancel an in-flight auth so deleting/disabling a server doesn't leave the
    // browser flow hanging until its timeout.
    this.pendingAuth.get(serverId)?.abort();
    this.pendingAuth.delete(serverId);
    this.cancelReconnect(serverId);
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

  async callTool(
    serverId: string,
    rawName: string,
    args: Record<string, unknown>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CallToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} is not connected`);
    try {
      return await conn.callTool(rawName, args, opts);
    } catch (err) {
      // A call that 401s mid-session means the saved token expired and couldn't
      // refresh — surface it as needs-auth so the user can re-authenticate.
      if (err instanceof UnauthorizedError) this.statuses.set(serverId, 'needs-auth');
      throw err;
    }
  }

  async dispose(): Promise<void> {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    const conns = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(conns.map((c) => c.close()));
  }
}

/** Single instance for the main process; wired into startup and getTools later. */
export const mcpManager = new McpManager();
