import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../../log';
import { buildCatalog, type McpToolEntry } from './catalog';
import type { ResolvedMcpServer } from './config';
import { McpConnection } from './connection';

const log = createLogger('mcp');

/**
 * Process-wide registry of connected MCP servers. Connects enabled servers,
 * aggregates their tools into one uniquely-named catalog, and routes calls back
 * to the owning server. A server that fails to connect is logged and skipped —
 * it never blocks the others.
 */
export class McpManager {
  private readonly connections = new Map<string, McpConnection>();

  async init(servers: ResolvedMcpServer[]): Promise<void> {
    await Promise.allSettled(servers.filter((s) => s.enabled).map((s) => this.connect(s)));
  }

  async connect(server: ResolvedMcpServer): Promise<void> {
    const conn = new McpConnection(server);
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

  /** Reconnect a server after its config changed: drop the old connection, dial anew. */
  async reload(server: ResolvedMcpServer): Promise<void> {
    await this.disconnect(server.id);
    await this.connect(server);
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
