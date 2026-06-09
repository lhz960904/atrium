import { Check, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PendingApproval } from '../../lib/approvals';

/** Hold the confirmation this long, then slide out and send the response. */
const CONFIRM_HOLD_MS = 600;
const FADE_MS = 180;
const SLIDE_MS = 240;

type ApprovalCardProps = {
  approval: PendingApproval;
  /** How many further approvals are queued behind this one. */
  more: number;
  onApprove: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
};

/**
 * The transient gate above the composer when a tool call crosses the workspace
 * boundary. It fades in at full height (a height-grow animation fights the
 * bottom-docked layout and tears a gap above the composer mid-transition, so
 * we don't), shows what's about to run and why, takes the decision, confirms
 * briefly, then fades out — the lasting record is the tool marker in the
 * conversation, not a banner here. The response is sent only after the fade,
 * so the card (its part still awaiting approval) stays mounted through it.
 */
export function ApprovalCard({
  approval,
  more,
  onApprove,
  onDeny,
}: ApprovalCardProps): React.JSX.Element {
  const [shown, setShown] = useState(false);
  const [decided, setDecided] = useState<'once' | 'deny' | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Fade in on mount; the rAF lets the 0→1 opacity transition actually run.
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const pending = timers.current;
    return () => {
      cancelAnimationFrame(r);
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const decide = (kind: 'once' | 'deny'): void => {
    if (decided) return;
    setDecided(kind);
    timers.current.push(
      setTimeout(() => setShown(false), CONFIRM_HOLD_MS),
      setTimeout(
        () => (kind === 'deny' ? onDeny(approval.approvalId) : onApprove(approval.approvalId)),
        CONFIRM_HOLD_MS + SLIDE_MS,
      ),
    );
  };

  const danger = approval.crossing?.kind === 'dangerous';
  const tint = danger ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning';
  const reason = approval.crossing?.reason ?? '需要确认';

  return (
    // Slides up out of the composer (which paints on top, masking the lower
    // edge) — a toast-style entrance. Transform only, never height: a height
    // grow tears a gap in this bottom-docked layout.
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity ${FADE_MS}ms var(--ease-out), transform ${SLIDE_MS}ms var(--ease-out)`,
      }}
      className="overflow-hidden rounded-t-xl border border-border-default border-b-0 bg-surface"
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
