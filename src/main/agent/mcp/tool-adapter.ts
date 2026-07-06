import type { ImageToolOutput } from '@shared/chat-types';
import { dynamicTool, jsonSchema, type Tool } from 'ai';
import type { McpToolEntry } from './catalog';
import type { McpManager } from './manager';
import { renderToolResult } from './render';
import { spillOversizedImages } from './spill';

type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>;

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
  opts: { imageToolResults: boolean; workspaceRoot: string },
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
      toModelOutput: ({ output }) => mcpOutputToModelOutput(output, opts.imageToolResults),
    });
  }
  return tools;
}

/**
 * Map a tool output onto the wire format. Plain strings (text-only results and
 * pre-image history rows) go out as text. Structured outputs inline their images
 * as image-data parts — unless the provider+model can't consume image tool
 * results, in which case the images are dropped with an explicit note so the
 * model knows what it isn't seeing.
 */
export function mcpOutputToModelOutput(
  output: unknown,
  imageToolResults: boolean,
): ToolResultOutput {
  if (typeof output === 'string') return { type: 'text', value: output };
  const { text, images } = output as ImageToolOutput;
  if (!imageToolResults) {
    const note = `[${images.length} image(s) omitted: the current model cannot view images]`;
    return { type: 'text', value: text ? `${text}\n${note}` : note };
  }
  return {
    type: 'content',
    value: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...images.map((img) => ({
        type: 'image-data' as const,
        data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1),
        mediaType: img.mediaType,
      })),
    ],
  };
}
