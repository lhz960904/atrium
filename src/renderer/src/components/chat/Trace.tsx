import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Trace as TraceData } from '../../lib/chat-types';
import { SegmentList } from './SegmentList';

export function Trace({ trace }: { trace: TraceData }): React.JSX.Element {
  const hasTool = trace.segments.some((s) => s.kind === 'tool' || s.kind === 'subagent');
  if (!hasTool && !trace.running) {
    return <SegmentList segments={trace.segments} />;
  }
  return <TraceWithHead trace={trace} />;
}

function TraceWithHead({ trace }: { trace: TraceData }): React.JSX.Element {
  const [open, setOpen] = useState(!!trace.running);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 py-1 text-fg-tertiary text-md hover:text-fg-secondary"
      >
        {trace.running && <span className="size-2 animate-pulse rounded-full bg-accent" />}
        <span>{trace.summary}</span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="pt-1 pb-2">
          <SegmentList segments={trace.segments} />
        </div>
      )}
    </div>
  );
}
