import type { AtriumUIMessage } from '@shared/chat';
import { isMcpToolName, parseMcpToolName } from '@shared/mcp';
import { analyzeBash, type Crossing, describeWriteEscape } from '@shared/permissions/analyze';
import { deriveRule, type TrustRule } from '@shared/permissions/rules';
import { getToolName, isToolOrDynamicToolUIPart } from '@shared/ui-message';

/** A tool call paused for user approval, with its crossing reason for display. */
export type PendingApproval = {
  approvalId: string;
  toolName: string;
  /** The command (bash) or path (write/edit) to show, verbatim. */
  target: string;
  /** Mono prefix: `$ ` for a shell command, `✎ ` for a file write. */
  prefix: string;
  crossing: Crossing | null;
  /** The rule "always allow" would persist, or null when the call can't reduce to one. */
  rule: TrustRule | null;
};

/** Tool calls in the message stream currently awaiting an approval response. */
export function getPendingApprovals(messages: AtriumUIMessage[]): PendingApproval[] {
  const pending: PendingApproval[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.parts) {
      // Both our built-ins (static tool-* parts) and MCP tools (dynamic-tool
      // parts) can pause for approval, so accept either shape here.
      if (isToolOrDynamicToolUIPart(part) && part.state === 'approval-requested') {
        pending.push(describe(part.approval.id, getToolName(part), part.input));
      }
    }
  }
  return pending;
}

function describe(approvalId: string, toolName: string, input: unknown): PendingApproval {
  const rule = deriveRule(toolName, input);
  if (isMcpToolName(toolName)) {
    const parsed = parseMcpToolName(toolName);
    const server = parsed?.server ?? toolName;
    return {
      approvalId,
      toolName,
      target: parsed ? `${server} · ${parsed.tool}` : toolName,
      prefix: '⚙ ',
      crossing: { code: 'mcp', subject: server },
      rule,
    };
  }
  if (toolName === 'bash') {
    const command = strField(input, 'command');
    const crossing = command ? analyzeBash(command) : null;
    return {
      approvalId,
      toolName,
      target: command,
      prefix: '$ ',
      crossing,
      rule,
    };
  }
  const path = strField(input, 'path');
  const crossing = path ? describeWriteEscape(path) : null;
  return { approvalId, toolName, target: path, prefix: '✎ ', crossing, rule };
}

function strField(input: unknown, key: string): string {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return '';
}
