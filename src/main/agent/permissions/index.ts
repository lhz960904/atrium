import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { CrossingCode } from '@shared/permissions/analyze';
import { isAllowed, type TrustRule } from '@shared/permissions/rules';
import { createLogger } from '../../log';
import type { ToolCtx } from '../tools/context';
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

/** The stream writer the run hands to tools via experimental_context, used to
 *  badge an auto-reviewed call. Narrowed structurally so this stays decoupled. */
type EmitContext = {
  emit?: (chunk: {
    type: 'data-autoReview';
    data: { toolCallId: string; subject: string };
    transient: true;
  }) => void;
};

/**
 * Bind a tool's `needsApproval` to the request's permission context. Returns a
 * sync boolean on the common paths (allow / prompt) and a promise only when
 * auto-review must consult the reviewer — which, lacking a model, also falls
 * back to a prompt. The reviewer can only turn a would-be prompt into a silent
 * allow; it never widens access on its own. On a silent allow it emits an
 * autoReview marker (via the run's stream writer in experimental_context) so
 * the trace shows the call was reviewed rather than slipped through ungated.
 */
export function makeNeedsApproval(toolName: string, ctx: ToolCtx) {
  return (
    input: unknown,
    options?: { toolCallId: string; experimental_context?: unknown },
  ): boolean | Promise<boolean> => {
    const permission = ctx.permission;
    const mode = permission?.mode ?? DEFAULT_PERMISSION_MODE;
    const verdict = staticVerdict(
      toolName,
      input,
      mode,
      ctx.workspaceRoot,
      permission?.rules ?? [],
    );
    if (verdict.kind === 'allow') return false;
    if (verdict.kind === 'prompt') {
      log.info(`${toolName} crossing → prompt (mode=${mode})`);
      return true;
    }

    const model = permission?.reviewerModel;
    // MCP calls have no command/path in their input — fall back to the crossing's
    // subject (the server name) so the reviewer/badge still has something to show.
    const subject = crossingSubject(input) || verdict.crossing.subject || '';
    if (!model) {
      log.info(`${toolName} crossing → prompt (auto-review, no reviewer model)`);
      return true;
    }
    return reviewBoundaryCrossing({
      model,
      subject,
      risk: RISK[verdict.crossing.code],
      abortSignal: permission.abortSignal,
    }).then((review) => {
      log.info(`${toolName} crossing → reviewer ${review}: ${subject}`);
      if (review === 'deny') return true;
      if (options?.toolCallId) {
        (options.experimental_context as EmitContext | undefined)?.emit?.({
          type: 'data-autoReview',
          data: { toolCallId: options.toolCallId, subject },
          transient: true,
        });
      }
      return false;
    });
  };
}
