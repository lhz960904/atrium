import type { PermissionMode } from '@shared/permissions';
import type { CrossingCode } from '@shared/permissions/analyze';
import { isAllowed, type TrustRule } from '@shared/permissions/rules';
import { createLogger } from '../../log';
import type { Complete } from '../pi/complete';
import { type Classification, classifyToolCall } from './classify';
import { reviewBoundaryCrossing } from './reviewer';

const log = createLogger('permission');

/** Plain-words framing of each static crossing, handed to the reviewer as a hint. */
const RISK: Record<CrossingCode, string> = {
  network: 'reaches the network',
  dangerous: 'is a potentially destructive command',
  substitution: 'contains command substitution that hides what really runs',
  unparseable: 'could not be parsed and may hide its real behavior',
  wrapper: 'wraps another command, hiding what actually executes',
  fsEscape: 'writes to a path outside the workspace',
  mcp: 'is a tool from an external MCP server',
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
  toolName: string,
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
  toolName: string,
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

export type ApprovalContext = {
  mode: PermissionMode;
  rules?: TrustRule[];
  workspaceRoot: string;
  /** Reviewer call for auto-review mode; absent → auto-review falls back to prompting. */
  review?: Complete;
  /** The turn's abort signal, so a stopped turn also cancels an in-flight review. */
  abortSignal?: AbortSignal;
  /** Marks a crossing the reviewer waved through, so the trace shows it was
   *  reviewed rather than slipped through ungated. */
  onReviewed?: (call: { toolCallId: string; subject: string }) => void;
};

/**
 * The permission verdict for one call. Sync on the common paths (allow /
 * prompt) and a promise only when auto-review must consult the reviewer —
 * which, lacking a model, also falls back to a prompt. The reviewer can only
 * turn a would-be prompt into a silent allow; it never widens access.
 */
export function approvalGate(ctx: ApprovalContext) {
  return (toolName: string, input: unknown, toolCallId?: string): boolean | Promise<boolean> => {
    const verdict = staticVerdict(toolName, input, ctx.mode, ctx.workspaceRoot, ctx.rules ?? []);
    if (verdict.kind === 'allow') return false;
    if (verdict.kind === 'prompt') {
      log.info(`${toolName} crossing → prompt (mode=${ctx.mode})`);
      return true;
    }

    // MCP calls have no command/path in their input — fall back to the crossing's
    // subject (the server name) so the reviewer/badge still has something to show.
    const subject = crossingSubject(input) || verdict.crossing.subject || '';
    if (!ctx.review) {
      log.info(`${toolName} crossing → prompt (auto-review, no reviewer model)`);
      return true;
    }
    return reviewBoundaryCrossing({
      complete: ctx.review,
      subject,
      risk: RISK[verdict.crossing.code],
      abortSignal: ctx.abortSignal,
    }).then((review) => {
      log.info(`${toolName} crossing → reviewer ${review}: ${subject}`);
      if (review === 'deny') return true;
      if (toolCallId) ctx.onReviewed?.({ toolCallId, subject });
      return false;
    });
  };
}
