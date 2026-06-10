import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { AcpPermissionDecision } from '@shared/chat';

type Entry = {
  threadId: string;
  options: PermissionOption[];
  resolve: (res: RequestPermissionResponse) => void;
};

const DECISIONS = [
  'allow_once',
  'allow_always',
  'reject_once',
] as const satisfies readonly AcpPermissionDecision[];

/** Validate a decision arriving over HTTP — anything else must be rejected at
 *  the endpoint, since the outcome mapping treats unknown values as a deny. */
export function isAcpDecision(value: unknown): value is AcpPermissionDecision {
  return (DECISIONS as readonly unknown[]).includes(value);
}

/**
 * Holds the in-flight ACP permission requests whose onPermission promise is
 * parked awaiting the user. Unlike native tool approvals (which end the turn
 * and resume from the DB on a fresh request), an external agent blocks inside
 * its live prompt turn until requestPermission returns — so the decision must
 * reach that very promise, delivered on a side HTTP call while the turn's
 * stream stays open. One broker for the server's lifetime (like the session
 * registry); requests are keyed by a minted id so concurrent asks across
 * threads never collide. Entries are settled exactly once: by the user's
 * decision, or by cancelThread on stop/abort/agent death.
 */
export class AcpPermissionBroker {
  private readonly pending = new Map<string, Entry>();
  private seq = 0;

  /** Park a request; the returned promise settles when resolve/cancelThread runs. */
  request(
    threadId: string,
    options: PermissionOption[],
  ): { requestId: string; response: Promise<RequestPermissionResponse> } {
    this.seq += 1;
    const requestId = `acp-perm-${this.seq}`;
    const response = new Promise<RequestPermissionResponse>((resolve) => {
      this.pending.set(requestId, { threadId, options, resolve });
    });
    return { requestId, response };
  }

  /**
   * Settle a parked request with the user's decision, mapped server-side to one
   * of the agent-supplied options. Returns false for an unknown id (already
   * settled, or stale after a restart) — the caller treats that as a no-op.
   */
  resolve(requestId: string, decision: AcpPermissionDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(toOutcome(entry.options, decision));
    return true;
  }

  /** Cancel every parked request for a thread (stop/abort, agent died mid-ask). */
  cancelThread(threadId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.threadId !== threadId) continue;
      this.pending.delete(id);
      entry.resolve({ outcome: { outcome: 'cancelled' } });
    }
  }
}

/**
 * Map the semantic decision to an agent-supplied option. Fallbacks never
 * escalate what the user granted: "always" may downgrade to a one-shot allow,
 * a deny may upgrade to a persistent deny (stricter), but a one-shot allow is
 * never widened to "always" — with no exact match it becomes cancelled.
 */
function toOutcome(
  options: PermissionOption[],
  decision: AcpPermissionDecision,
): RequestPermissionResponse {
  const byKind = (kind: PermissionOption['kind']) => options.find((o) => o.kind === kind)?.optionId;
  const optionId =
    decision === 'allow_once'
      ? byKind('allow_once')
      : decision === 'allow_always'
        ? (byKind('allow_always') ?? byKind('allow_once'))
        : (byKind('reject_once') ?? byKind('reject_always'));
  return optionId
    ? { outcome: { outcome: 'selected', optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
