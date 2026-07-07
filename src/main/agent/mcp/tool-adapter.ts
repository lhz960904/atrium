import { dynamicTool, jsonSchema, type Tool } from 'ai';
import { imageOutputToModelOutput } from '../tools/output';
import type { McpToolEntry } from './catalog';
import type { McpManager } from './manager';
import { renderToolResult } from './render';
import { spillOversizedImages } from './spill';

/**
 * Wrap each catalog entry as an AI SDK tool keyed by its qualified name, ready to
 * merge into the agent's toolset. dynamicTool fits MCP: the input schema is only
 * known at runtime. Each execute routes back through the manager by serverId +
 * rawName. Text results pass through as-is; image blocks become real image parts
 * via toModelOutput when the active provider+model can consume them, and degrade
 * to a text note when they can't.
 */
export function buildMcpTools(
  entries: McpToolEntry[],
  manager: McpManager,
  opts: { supportsImageToolResults: boolean; workspaceRoot: string },
): Record<string, Tool> {
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
        return spillOversizedImages(renderToolResult(result), opts.workspaceRoot);
      },
      toModelOutput: ({ output }) =>
        imageOutputToModelOutput(output, opts.supportsImageToolResults),
    });
  }
  return tools;
}
