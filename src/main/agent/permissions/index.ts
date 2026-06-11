import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { CrossingCode } from '@shared/permissions/analyze';
import { isAllowed, type TrustRule } from '@shared/permissions/rules';
import type { ToolName } from '@shared/tools';
import type { ToolCtx } from '../tools/context';
import { type Classification, classifyToolCall } from './classify';
import { reviewBoundaryCrossing } from './reviewer';

/** Plain-words framing of each static crossing, handed to the reviewer as a hint. */
const RISK: Record<CrossingCode, string> = {
  network: 'reaches the network',
  dangerous: 'is a potentially destructive command',
  substitution: 'contains command substitution that hides what really runs',
  unparseable: 'could not be parsed and may hide its real behavior',
  wrapper: 'wraps another command, hiding what actually executes',
  fsEscape: 'writes to a path outside the workspace',
};

/**
 * The static (pre-reviewer) verdict for a tool call:
 *  - `allow`  — runs without asking (in-bounds, trusted, or full-access).
 *  - `prompt` — pauses for the user (a crossing under default mode).
 *  - `review` — a crossing under auto-review mode: hand to the reviewer model.
 */
type StaticVerdict =
  | { kind: 'allow' }
  | { kind: 'prompt' }
  | { kind: 'review'; crossing: Classification & { crosses: true } };

function staticVerdict(
  toolName: ToolName,
  input: unknown,
  mode: PermissionMode,
  workspaceRoot: string,
  rules: TrustRule[],
): StaticVerdict {
  if (mode === 'full-access') return { kind: 'allow' };
  const crossing = classifyToolCall(toolName, input, workspaceRoot);
  if (!crossing.crosses) return { kind: 'allow' };
  if (isAllowed(rules, toolName, input)) return { kind: 'allow' };
  return mode === 'auto-review' ? { kind: 'review', crossing } : { kind: 'prompt' };
}

/**
 * Whether a tool call must pause for user approval, deciding only on the static
 * gate: full-access runs everything; the other modes prompt when the call
 * crosses the workspace boundary AND the trust list doesn't cover it. The
 * auto-review reviewer is async, so this sync view treats a to-be-reviewed
 * crossing as a prompt — the safe fallback when no reviewer is wired.
 */
export function needsApprovalFor(
  toolName: ToolName,
  input: unknown,
  mode: PermissionMode,
  workspaceRoot: string,
  rules: TrustRule[] = [],
): boolean {
  return staticVerdict(toolName, input, mode, workspaceRoot, rules).kind !== 'allow';
}

/** The command (bash) or path (write/edit) to hand the reviewer verbatim. */
function crossingSubject(input: unknown): string {
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    for (const key of ['command', 'path']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
  }
  return '';
}

/**
 * Bind a tool's `needsApproval` to the request's permission context. Returns a
 * sync boolean on the common paths (allow / prompt) and a promise only when
 * auto-review must consult the reviewer — which, lacking a model, also falls
 * back to a prompt. The reviewer can only turn a would-be prompt into a silent
 * allow; it never widens access on its own.
 */
export function makeNeedsApproval(toolName: ToolName, ctx: ToolCtx) {
  return (input: unknown): boolean | Promise<boolean> => {
    const permission = ctx.permission;
    const verdict = staticVerdict(
      toolName,
      input,
      permission?.mode ?? DEFAULT_PERMISSION_MODE,
      ctx.workspaceRoot,
      permission?.rules ?? [],
    );
    if (verdict.kind === 'allow') return false;
    if (verdict.kind === 'prompt') return true;

    const model = permission?.reviewerModel;
    if (!model) return true; // auto-review without a configured reviewer → ask the user
    return reviewBoundaryCrossing({
      model,
      subject: crossingSubject(input),
      risk: RISK[verdict.crossing.code],
      abortSignal: permission.abortSignal,
    }).then((review) => review === 'deny');
  };
}
