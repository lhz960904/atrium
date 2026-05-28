import type { TraceSegment } from '../../lib/chat-types';
import { NarrativeSegment } from './NarrativeSegment';
import { SubagentCard } from './SubagentCard';
import { ToolMarker } from './ToolMarker';

export function SegmentList({ segments }: { segments: TraceSegment[] }): React.JSX.Element {
  return (
    <>
      {segments.map((seg) => {
        if (seg.kind === 'narrative') {
          return <NarrativeSegment key={seg.id} content={seg.content} />;
        }
        if (seg.kind === 'tool') {
          return <ToolMarker key={seg.tool.id} tool={seg.tool} />;
        }
        return <SubagentCard key={seg.subagent.id} subagent={seg.subagent} />;
      })}
    </>
  );
}
