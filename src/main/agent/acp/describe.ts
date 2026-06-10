import type { ToolCallUpdate } from '@agentclientprotocol/sdk';

export type AcpToolCallView = { title: string; target: string; prefix: string };

/**
 * Reduce an ACP tool call (arbitrary external-agent tool, loosely-typed input)
 * to what the approval card shows. Mirrors the native card's presentation:
 * shell commands get `$ `, file changes get `✎ `; anything unrecognized falls
 * back to the agent's own human-readable title so the card never shows blank.
 */
export function describeAcpToolCall(toolCall: ToolCallUpdate): AcpToolCallView {
  const title = toolCall.title ?? toolCall.kind ?? 'tool';
  if (toolCall.kind === 'execute') {
    const command = strField(toolCall.rawInput, 'command');
    if (command) return { title, target: command, prefix: '$ ' };
  }
  if (toolCall.kind === 'edit' || toolCall.kind === 'delete' || toolCall.kind === 'move') {
    const path =
      strField(toolCall.rawInput, 'path') ||
      strField(toolCall.rawInput, 'file_path') ||
      toolCall.locations?.[0]?.path ||
      '';
    if (path) return { title, target: path, prefix: '✎ ' };
  }
  return { title, target: title, prefix: '' };
}

function strField(input: unknown, key: string): string {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return '';
}
