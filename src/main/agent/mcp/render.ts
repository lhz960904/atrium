import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { headTruncate } from '../tools/output';

// Caps the inline result like the file tools do; spilling oversized output to
// disk (with a read_file pointer) is a later milestone.
const MCP_OUTPUT_MAX = 50_000;

export type McpImage = { mediaType: string; dataUrl: string };

/** Structured MCP output: flattened text plus the image blocks worth showing. */
export type McpToolOutput = { text: string; images: McpImage[] };

/**
 * Flatten an MCP tool result into the tool's output. Text-only results stay a
 * plain string — this keeps new outputs shape-compatible with history persisted
 * before image support existed, so downstream code handles one union everywhere.
 * Results carrying images return { text, images } so toModelOutput can emit real
 * image parts and the renderer can display them. Error results stay text-only:
 * every block (images included) collapses to its text summary.
 */
export function renderToolResult(result: CallToolResult): string | McpToolOutput {
  const images: McpImage[] = [];
  const textParts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'image' && !result.isError) {
      images.push({
        mediaType: block.mimeType,
        dataUrl: `data:${block.mimeType};base64,${block.data}`,
      });
      continue;
    }
    textParts.push(renderBlock(block));
  }
  const body = headTruncate(
    textParts.join('\n'),
    MCP_OUTPUT_MAX,
    'call the tool again with a narrower request',
  );
  if (result.isError) return `The tool reported an error:\n${body}`;
  return images.length > 0 ? { text: body, images } : body;
}

function renderBlock(block: CallToolResult['content'][number]): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
    case 'audio':
      return `[${block.type} content: ${block.mimeType}]`;
    case 'resource_link':
      return `[resource: ${block.uri}]`;
    case 'resource':
      return 'text' in block.resource
        ? block.resource.text
        : `[embedded resource: ${block.resource.uri}]`;
    default:
      return `[${(block as { type: string }).type} content]`;
  }
}
