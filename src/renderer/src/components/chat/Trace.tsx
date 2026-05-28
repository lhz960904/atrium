import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Trace as TraceData } from '../../lib/chat-types';
import { NarrativeSegment } from './NarrativeSegment';
import { ToolMarker } from './ToolMarker';

export function Trace({ trace }: { trace: TraceData }): React.JSX.Element {
  const hasTool = trace.segments.some((s) => s.kind === 'tool');
  // No tool → no need for the trace head, just inline the narrative.
  if (!hasTool && !trace.running) {
    return <SegmentList trace={trace} />;
  }

  // Has tool calls (or still running) → show collapsible head. Default
  // open while running so the user can watch progress; default closed
  // after completion (D3 lifecycle).
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
          <SegmentList trace={trace} />
        </div>
      )}
    </div>
  );
}

function SegmentList({ trace }: { trace: TraceData }): React.JSX.Element {
  return (
    <>
      {trace.segments.map((seg) =>
        seg.kind === 'narrative' ? (
          <NarrativeSegment key={seg.id} content={seg.content} />
        ) : (
          <ToolMarker key={seg.tool.id} tool={seg.tool} />
        ),
      )}
    </>
  );
}
