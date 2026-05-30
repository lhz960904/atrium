import type { AtriumUIMessage } from '@shared/chat';
import { buildAssistantView } from '../../lib/assistant-view';
import { TraceBlock } from './TraceBlock';

export function AssistantMessage({
  message,
  streaming,
}: {
  message: AtriumUIMessage;
  streaming: boolean;
}): React.JSX.Element {
  const view = buildAssistantView(message.parts);
  const createdAt = message.metadata?.createdAt;

  // While the turn is live, the trace/final split hasn't settled, so the work
  // (tools + narrative) streams as one block. Thinking still gets its own
  // block: it collapses to "Thought" the moment any work begins.
  if (streaming) {
    const work = [...view.trace, ...view.final];
    const thinkingLive = work.length === 0;
    return (
      <div className="mb-7">
        {view.thinking.length > 0 && (
          <TraceBlock
            kind="thought"
            segments={view.thinking}
            streaming={thinkingLive}
            hasFinal
            createdAt={createdAt}
          />
        )}
        {work.length > 0 && (
          <TraceBlock
            kind="work"
            segments={work}
            toolCount={view.toolCount}
            streaming
            hasFinal={false}
            createdAt={createdAt}
          />
        )}
      </div>
    );
  }

  const hasFinal = view.final.some((seg) => seg.kind === 'narrative');
  const durationMs = message.metadata?.durationMs;
  return (
    <div className="mb-7">
      {view.thinking.length > 0 && (
        <TraceBlock
          kind="thought"
          segments={view.thinking}
          streaming={false}
          hasFinal={hasFinal || view.trace.length > 0}
          // The whole-turn duration equals thinking time only when no tool ran.
          durationMs={view.toolCount === 0 ? durationMs : undefined}
        />
      )}
      {view.trace.length > 0 && (
        <TraceBlock
          kind="work"
          segments={view.trace}
          toolCount={view.toolCount}
          streaming={false}
          hasFinal={hasFinal}
          durationMs={durationMs}
        />
      )}
      {view.final.map((seg, i) =>
        seg.kind === 'narrative' ? (
          <div
            key={seg.id}
            className={`my-3 whitespace-pre-wrap text-base leading-relaxed ${
              i === 0 ? 'text-fg-primary' : 'text-fg-secondary'
            }`}
          >
            {seg.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
