import type { AtriumUIMessage } from '@shared/chat';
import { analyzeBash, type Crossing, describeWriteEscape } from '@shared/permissions/analyze';
import { deriveRule, type TrustRule } from '@shared/permissions/rules';
import type { AtriumTools, ToolName } from '@shared/tools';
import { getStaticToolName, isStaticToolUIPart } from 'ai';

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
      if (isStaticToolUIPart(part) && part.state === 'approval-requested') {
        pending.push(describe(part.approval.id, getStaticToolName<AtriumTools>(part), part.input));
      }
    }
  }
  return pending;
}

function describe(approvalId: string, toolName: ToolName, input: unknown): PendingApproval {
  const rule = deriveRule(toolName, input);
  if (toolName === 'bash') {
    const command = strField(input, 'command');
    const crossing = command ? analyzeBash(command) : null;
    return { approvalId, toolName, target: command, prefix: '$ ', crossing, rule };
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
