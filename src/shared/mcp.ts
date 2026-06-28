/*
 * MCP tool naming shared across processes. Tools from MCP servers are flattened
 * into the agent's toolset under a reserved namespace — `mcp__<server>__<tool>`
 * — so the renderer (approval card, tool markers) and the permission gate can
 * recognize and parse them without importing the main-process connection layer.
 * The name *builder* (slug + collision hashing, which needs node:crypto) lives in
 * main's naming.ts; only the prefix and the pure parse live here.
 */
export const MCP_TOOL_PREFIX = 'mcp';
export const MCP_TOOL_SEP = '__';

export function isMcpToolName(name: string): boolean {
  return name.startsWith(`${MCP_TOOL_PREFIX}${MCP_TOOL_SEP}`);
}

/**
 * Split a qualified name back into its sanitized server/tool segments. Because
 * slug() forbids `__` inside a segment, the first `__` after the prefix is the
 * real boundary. Returns null for non-MCP or malformed names.
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!isMcpToolName(name)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length + MCP_TOOL_SEP.length);
  const i = rest.indexOf(MCP_TOOL_SEP);
  if (i <= 0 || i + MCP_TOOL_SEP.length >= rest.length) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + MCP_TOOL_SEP.length) };
}
