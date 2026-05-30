import type { TraceSegment } from '@shared/chat-types';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SegmentList } from './SegmentList';

/**
 * The collapsible header over part of an assistant turn — either the reasoning
 * ("Thought …") or the work, i.e. tool calls + narrative ("Worked …"). Open
 * with a live ticker + pulsing dot while that part streams, then collapses to
 * a static summary.
 */
export function TraceBlock({
  kind,
  segments,
  toolCount = 0,
  streaming,
  hasFinal,
  createdAt,
  durationMs,
}: {
  kind: 'thought' | 'work';
  segments: TraceSegment[];
  toolCount?: number;
  streaming: boolean;
  /** Whether content follows this block (answer / a later block) — if not, it
   *  stays expanded so the message is never a bare header. */
  hasFinal: boolean;
  createdAt?: number;
  durationMs?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(streaming);
  // Follow the stream: open while this part streams; once done, collapse only
  // if something follows it — otherwise the message would be a bare header.
  useEffect(() => setOpen(streaming || !hasFinal), [streaming, hasFinal]);

  const rest = kind === 'thought' ? 'Thought' : 'Worked';
  const live = kind === 'thought' ? 'Thinking' : 'Working';

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group inline-flex items-center gap-2 py-1 text-md ${
          streaming ? 'text-fg-secondary' : 'text-fg-tertiary hover:text-fg-secondary'
        }`}
      >
        {streaming && <span className="size-2 animate-pulse rounded-full bg-accent" />}
        {streaming ? (
          <LiveLabel verb={live} createdAt={createdAt} />
        ) : (
          <span>
            {durationMs != null ? `${rest} for ${formatRest(durationMs)}` : rest}
            {kind === 'work' && toolCount > 0 && (
              <span className="text-fg-disabled"> · {toolCount} steps</span>
            )}
          </span>
        )}
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="pt-1 pb-2">
          <SegmentList segments={segments} />
        </div>
      )}
    </div>
  );
}

function LiveLabel({ verb, createdAt }: { verb: string; createdAt?: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Hold off on the timer until the server's start time has arrived and at
  // least a second has elapsed — no flash of "0m 00s".
  const sec = createdAt != null ? Math.max(0, Math.floor((now - createdAt) / 1000)) : 0;
  return (
    <span>
      {verb}…{sec > 0 ? ` ${formatLive(sec)}` : ''}
    </span>
  );
}

function formatRest(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatLive(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
}
