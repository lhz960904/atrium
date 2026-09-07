import type { AtriumTool } from '../tools/define';
import { defineTool, imageResult, Type } from '../tools/define';
import type { McpToolEntry } from './catalog';
import type { McpManager } from './manager';
import { renderToolResult } from './render';
import { spillOversizedImages } from './spill';

/**
 * Wrap each catalog entry as a tool keyed by its qualified name, ready to merge
 * into the agent's toolset. An MCP server publishes JSON Schema and the engine
 * consumes JSON Schema, so the schema is carried through untouched — only its
 * static type is unknown, hence Type.Unsafe. Each execute routes back through
 * the manager by serverId + rawName. Text results pass through as-is; image
 * blocks become real image content when the active provider+model can consume
 * them, and degrade to a text note when they can't.
 */
export function buildMcpTools(
  entries: McpToolEntry[],
  manager: McpManager,
  opts: { supportsImageToolResults: boolean; workspaceRoot: string },
): AtriumTool[] {
  return entries.map((entry) =>
    defineTool({
      name: entry.qualifiedName,
      label: entry.rawName,
      description: entry.description ?? '',
      parameters: Type.Unsafe<Record<string, unknown>>(entry.inputSchema),
      execute: async (_id, input, signal) => {
        const result = await manager.callTool(entry.serverId, entry.rawName, input ?? {}, {
          signal,
        });
        return imageResult(
          await spillOversizedImages(renderToolResult(result), opts.workspaceRoot),
          opts.supportsImageToolResults,
        );
      },
    }),
  );
}
