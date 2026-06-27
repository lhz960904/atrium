import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { headTruncate } from '../tools/output';

// M0 caps the inline result like the file tools do; spilling oversized output to
// disk (with a read_file pointer) is a later milestone.
const MCP_OUTPUT_MAX = 50_000;

/** Flatten an MCP tool result's content blocks into model-readable text. */
export function renderToolResult(result: CallToolResult): string {
  const body = headTruncate(
    result.content.map(renderBlock).join('\n'),
    MCP_OUTPUT_MAX,
    'call the tool again with a narrower request',
  );
  return result.isError ? `The tool reported an error:\n${body}` : body;
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
