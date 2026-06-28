import { dynamicTool, jsonSchema, type Tool } from 'ai';
import type { McpToolEntry } from './catalog';
import type { McpManager } from './manager';
import { renderToolResult } from './render';

/**
 * Wrap each catalog entry as an AI SDK tool keyed by its qualified name, ready to
 * merge into the agent's toolset. dynamicTool fits MCP: the input schema is only
 * known at runtime. Each execute routes back through the manager by serverId +
 * rawName and flattens the result to text. Approval and large-output spilling are
 * layered on in later milestones.
 */
export function buildMcpTools(entries: McpToolEntry[], manager: McpManager): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const entry of entries) {
    tools[entry.qualifiedName] = dynamicTool({
      description: entry.description ?? '',
      inputSchema: jsonSchema(entry.inputSchema),
      execute: async (input, { abortSignal }) => {
        const result = await manager.callTool(
          entry.serverId,
          entry.rawName,
          (input ?? {}) as Record<string, unknown>,
          { signal: abortSignal },
        );
        return renderToolResult(result);
      },
    });
  }
  return tools;
}
