import { isMcpToolName } from './mcp';
import { type Content, contentText } from './protocol';
import type { ToolApproval } from './ui-message';

/**
 * What a tool call looks like on a card, decided once for both readers.
 *
 * A run reaches the screen two ways: assembled from the event stream while it
 * runs, and projected from stored entries when the thread is reopened. Those
 * are different jobs — one folds deltas, the other reads finished messages —
 * but they must agree on what a card says, or a turn changes the moment it is
 * reloaded. Everything both of them decide lives here; the fields are returned
 * rather than whole parts, because one merges them into a part it is holding
 * and the other builds a part around them.
 */

/** Shown when a run ended before the user answered the approval it was waiting on. */
export const CALL_UNDECIDED = 'The run stopped before this call was decided.';

/** The failure text a card reads, which pi puts in the result's content. */
export const toolErrorText = (content: Content[]): string =>
  contentText(content).trim() || 'Tool failed.';

/**
 * Which part a call belongs in. An MCP tool's name is not known at build time,
 * so it rides as a field instead of in the part's type.
 */
export function toolPartIdentity(
  name: string,
  toolCallId: string,
): { type: string; toolCallId: string; toolName?: string } {
  return isMcpToolName(name)
    ? { type: 'dynamic-tool', toolCallId, toolName: name }
    : { type: `tool-${name}`, toolCallId };
}

/** How a finished execution reads: its output, or why it failed. */
export function toolResultFields(
  result: { content: Content[]; details?: unknown },
  isError: boolean,
): { state: 'output-available'; output: unknown } | { state: 'output-error'; errorText: string } {
  return isError
    ? { state: 'output-error', errorText: toolErrorText(result.content) }
    : { state: 'output-available', output: result.details };
}

/**
 * How the user's answer reads on the card.
 *
 * A denial is the user's decision, and the error result pi stands in for the
 * blocked call must never replace it — so a denied call is terminal here and
 * whatever arrives afterwards is ignored by both readers.
 */
export function approvalFields(
  approvalId: string,
  outcome: { kind: string; reason?: string },
):
  | { state: 'approval-responded'; approval: ToolApproval }
  | { state: 'output-denied'; approval: ToolApproval }
  | { state: 'output-error'; errorText: string }
  | undefined {
  const approval = { id: approvalId };
  if (outcome.kind === 'approved') {
    return { state: 'approval-responded', approval: { ...approval, approved: true } };
  }
  if (outcome.kind === 'denied') {
    return {
      state: 'output-denied',
      approval: {
        ...approval,
        approved: false,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      },
    };
  }
  if (outcome.kind === 'interrupted') {
    return { state: 'output-error', errorText: CALL_UNDECIDED };
  }
  // An answer or a cancellation is carried by the call's own result.
  return undefined;
}
