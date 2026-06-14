import type { ClarifyResult } from '@shared/chat-types';
import type { ViewSegment } from '../../lib/assistant-view';
import { ClarifyCard } from './ClarifyCard';
import { GeneratedImage } from './GeneratedImage';
import { NarrativeSegment } from './NarrativeSegment';
import { SubagentCard } from './SubagentCard';
import { ToolMarker } from './ToolMarker';

type SegmentListProps = {
  segments: ViewSegment[];
  /** Submit a clarification's answers (a card may appear inline in the trace). */
  onAnswer: (toolCallId: string, result: ClarifyResult) => void;
  /** The turn is live — narrative tokens fade in as they arrive. */
  streaming?: boolean;
};

export function SegmentList({
  segments,
  onAnswer,
  streaming = false,
}: SegmentListProps): React.JSX.Element {
  return (
    <>
      {segments.map((seg) => {
        if (seg.kind === 'narrative') {
          return <NarrativeSegment key={seg.id} content={seg.content} streaming={streaming} />;
        }
        if (seg.kind === 'tool') {
          return <ToolMarker key={seg.tool.id} tool={seg.tool} />;
        }
        if (seg.kind === 'subagent') {
          return <SubagentCard key={seg.subagent.id} subagent={seg.subagent} />;
        }
        if (seg.kind === 'image') {
          return (
            <GeneratedImage
              key={seg.id}
              url={seg.url}
              mediaType={seg.mediaType}
              filename={seg.filename}
            />
          );
        }
        return (
          <ClarifyCard
            key={seg.clarify.id}
            clarify={seg.clarify}
            pending={seg.pending}
            result={seg.result}
            onSubmit={(result) => onAnswer(seg.clarify.id, result)}
          />
        );
      })}
    </>
  );
}
