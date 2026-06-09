import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import { isAllowed, type TrustRule } from '@shared/permissions/rules';
import type { ToolName } from '@shared/tools';
import type { ToolCtx } from '../tools/context';
import { classifyToolCall } from './classify';

/**
 * Whether a tool call must pause for user approval under the active mode.
 * full-access runs everything; the other modes prompt only when the call
 * crosses the workspace boundary AND the trust list doesn't already cover it.
 * (The auto-review reviewer layers in later — like the trust list, it only
 * narrows a crossing back to "no approval", never the reverse.)
 */
export function needsApprovalFor(
  toolName: ToolName,
  input: unknown,
  mode: PermissionMode,
  workspaceRoot: string,
  rules: TrustRule[] = [],
): boolean {
  if (mode === 'full-access') return false;
  if (!classifyToolCall(toolName, input, workspaceRoot).crosses) return false;
  return !isAllowed(rules, toolName, input);
}

/** Bind a tool's `needsApproval` to the request's permission context. */
export function makeNeedsApproval(toolName: ToolName, ctx: ToolCtx) {
  return (input: unknown): boolean =>
    needsApprovalFor(
      toolName,
      input,
      ctx.permission?.mode ?? DEFAULT_PERMISSION_MODE,
      ctx.workspaceRoot,
      ctx.permission?.rules ?? [],
    );
}
