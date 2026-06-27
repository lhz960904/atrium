import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { qualifyToolName } from './naming';

/** One MCP tool surfaced to the agent, carrying everything routing/adapting needs. */
export type McpToolEntry = {
  // mcp__<server>__<tool>, unique across every connected server.
  qualifiedName: string;
  serverId: string;
  serverName: string;
  // The server's original tool name, used to call it (qualifiedName is lossy).
  rawName: string;
  description?: string;
  inputSchema: Tool['inputSchema'];
};

/**
 * Assign collision-free, provider-valid qualified names to every server's tools.
 * One `taken` set spans all servers, so two servers exposing the same tool name
 * still get distinct names. Order is stable (servers, then tools as listed).
 */
export function buildCatalog(
  servers: { id: string; name: string; tools: Tool[] }[],
): McpToolEntry[] {
  const taken = new Set<string>();
  const entries: McpToolEntry[] = [];
  for (const server of servers) {
    for (const tool of server.tools) {
      entries.push({
        qualifiedName: qualifyToolName(server.name, tool.name, taken),
        serverId: server.id,
        serverName: server.name,
        rawName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return entries;
}
