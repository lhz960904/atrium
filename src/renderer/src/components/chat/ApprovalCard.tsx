import { Check, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PendingApproval } from '../../lib/approvals';

/** Brief dwell so the decision registers before the card resolves and unmounts. */
const CONFIRM_MS = 900;

type ApprovalCardProps = {
  approval: PendingApproval;
  /** How many further approvals are queued behind this one. */
  more: number;
  /** Square the top corners so it sits flush under the plan panel. */
  attachedTop: boolean;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
};

/**
 * The transient gate above the composer when a tool call crosses the workspace
 * boundary. It shows what's about to run and why, takes the decision, then
 * confirms briefly and dismisses — the lasting record is the tool marker in the
 * conversation, not a banner here. The response is sent after the dwell, so the
 * card stays mounted (its part is still awaiting approval) for that beat.
 */
export function ApprovalCard({
  approval,
  more,
  attachedTop,
  onApprove,
  onDeny,
}: ApprovalCardProps): React.JSX.Element {
  const [decided, setDecided] = useState<'once' | 'deny' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const decide = (kind: 'once' | 'deny'): void => {
    if (decided) return;
    setDecided(kind);
    timer.current = setTimeout(() => {
      if (kind === 'deny') onDeny(approval.approvalId);
      else onApprove(approval.approvalId);
    }, CONFIRM_MS);
  };

  const danger = approval.crossing?.kind === 'dangerous';
  const tint = danger ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning';
  const reason = approval.crossing?.reason ?? '需要确认';

  return (
    <div
      className={`overflow-hidden border border-border-default border-b-0 bg-surface ${attachedTop ? '' : 'rounded-t-xl'}`}
    >
      {decided ? (
        <div
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm ${decided === 'deny' ? 'text-danger' : 'text-success'}`}
        >
          {decided === 'deny' ? (
            <X className="size-[15px] shrink-0" />
          ) : (
            <Check className="size-[15px] shrink-0" />
          )}
          <span>{decided === 'deny' ? '已拒绝' : '已允许一次'}</span>
        </div>
      ) : (
        <>
          <div className={`flex items-center gap-2 px-4 py-3 ${tint}`}>
            <TriangleAlert className="size-[15px] shrink-0" />
            <span className="font-semibold text-fg-primary text-sm">需要确认</span>
            <span className="min-w-0 truncate text-sm">· {reason}</span>
            {more > 0 && (
              <span className="ml-auto shrink-0 text-fg-tertiary text-xs">还有 {more} 项</span>
            )}
          </div>
          <div className="px-4 pt-3">
            <div className="break-all rounded-md bg-code-bg px-3 py-3 font-mono text-code-fg text-sm leading-snug">
              <span className="select-none text-fg-tertiary">{approval.prefix}</span>
              {approval.target}
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3">
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => decide('deny')}
              className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => decide('once')}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-fg-on-accent text-sm hover:bg-accent-hover"
            >
              允许一次
            </button>
          </div>
        </>
      )}
    </div>
  );
}
