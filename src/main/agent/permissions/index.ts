import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { ToolName } from '@shared/tools';
import type { ToolCtx } from '../tools/context';
import { classifyToolCall } from './classify';

/**
 * Whether a tool call must pause for user approval under the active mode.
 * full-access runs everything; the other modes prompt only when the call
 * crosses the workspace boundary. The trust list (skip a remembered call) and
 * the auto-review reviewer (let the model clear a crossing) layer on later —
 * both only narrow a crossing back to "no approval", never the reverse.
 */
export function needsApprovalFor(
  toolName: ToolName,
  input: unknown,
  mode: PermissionMode,
  workspaceRoot: string,
): boolean {
  if (mode === 'full-access') return false;
  return classifyToolCall(toolName, input, workspaceRoot).crosses;
}

/** Bind a tool's `needsApproval` to the request's permission context. */
export function makeNeedsApproval(toolName: ToolName, ctx: ToolCtx) {
  return (input: unknown): boolean =>
    needsApprovalFor(
      toolName,
      input,
      ctx.permission?.mode ?? DEFAULT_PERMISSION_MODE,
      ctx.workspaceRoot,
    );
}
