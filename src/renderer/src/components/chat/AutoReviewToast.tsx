import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Long enough to read the command, then it slides back out. */
const HOLD_MS = 2400;
const SLIDE_MS = 240;
const FADE_MS = 180;

type AutoReviewToastProps = {
  /** The command/path the reviewer approved, shown verbatim. */
  subject: string;
  /** Called after the exit animation finishes — the parent drops it from the queue. */
  onDone: () => void;
};

/**
 * A one-shot notice above the composer when the auto-review reviewer silently
 * approved a boundary crossing. Shares the approval card's slide-in/out motion
 * (it rises out of the composer, which paints on top to mask the lower edge),
 * but reads as a confirmation, not a gate — success-tinted, self-dismissing.
 * The lasting record is the shield badge on the tool marker.
 */
export function AutoReviewToast({ subject, onDone }: AutoReviewToastProps): React.JSX.Element {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  // Keep the latest onDone without restarting the one-shot timers below.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const enter = requestAnimationFrame(() => setShown(true));
    const exit = setTimeout(() => setShown(false), HOLD_MS);
    const done = setTimeout(() => onDoneRef.current(), HOLD_MS + SLIDE_MS);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(exit);
      clearTimeout(done);
    };
  }, []);

  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity ${FADE_MS}ms var(--ease-out), transform ${SLIDE_MS}ms var(--ease-out)`,
      }}
      className="overflow-hidden rounded-t-xl border border-success/30 border-b-0 bg-surface"
    >
      <div className="flex items-center gap-2 bg-success/10 px-4 py-3 text-success">
        <ShieldCheck className="size-[15px] shrink-0" />
        <span className="shrink-0 font-medium text-sm">{t('approval.autoReviewed')}</span>
        <code className="min-w-0 truncate font-mono text-fg-secondary text-sm">{subject}</code>
      </div>
    </div>
  );
}
