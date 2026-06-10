import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult } from '@shared/chat-types';
import { useTranslation } from 'react-i18next';
import { buildAssistantView } from '../../lib/assistant-view';
import { ClarifyCard } from './ClarifyCard';
import { CopyButton } from './CopyButton';
import { GeneratedImage } from './GeneratedImage';
import { Markdown } from './Markdown';
import { TraceBlock } from './TraceBlock';

type AssistantMessageProps = {
  message: AtriumUIMessage;
  streaming: boolean;
  /** Submit a clarification's answers (addToolOutput), which resumes the turn. */
  onAnswer: (toolCallId: string, result: ClarifyResult) => void;
  /** Dismiss a clarification without answering. */
  onCancel: (toolCallId: string) => void;
};

export function AssistantMessage({
  message,
  streaming,
  onAnswer,
  onCancel,
}: AssistantMessageProps): React.JSX.Element {
  const { t } = useTranslation();
  const view = buildAssistantView(message.parts, t);
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
            onAnswer={onAnswer}
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
            onAnswer={onAnswer}
          />
        )}
      </div>
    );
  }

  const hasFinal = view.final.length > 0;
  const durationMs = message.metadata?.durationMs;
  // The textual answer — the final narrative after any tool trace. Only this
  // gets a copy button; the tool-call trace above it doesn't.
  const answer = view.final
    .filter((s) => s.kind === 'narrative')
    .map((s) => s.content)
    .join('\n\n');
  return (
    <div className="group mb-7">
      {view.thinking.length > 0 && (
        <TraceBlock
          kind="thought"
          segments={view.thinking}
          streaming={false}
          hasFinal={hasFinal || view.trace.length > 0}
          // The whole-turn duration equals thinking time only when no tool ran.
          durationMs={view.toolCount === 0 ? durationMs : undefined}
          onAnswer={onAnswer}
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
          onAnswer={onAnswer}
        />
      )}
      {view.final.map((seg) =>
        seg.kind === 'narrative' ? (
          <div key={seg.id} className="my-3 text-fg-primary">
            <Markdown>{seg.content}</Markdown>
          </div>
        ) : seg.kind === 'image' ? (
          <GeneratedImage
            key={seg.id}
            url={seg.url}
            mediaType={seg.mediaType}
            filename={seg.filename}
          />
        ) : seg.kind === 'clarify' ? (
          <ClarifyCard
            key={seg.clarify.id}
            clarify={seg.clarify}
            pending={seg.pending}
            result={seg.result}
            onSubmit={(result) => onAnswer(seg.clarify.id, result)}
            onCancel={() => onCancel(seg.clarify.id)}
          />
        ) : null,
      )}
      {answer.length > 0 && (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={answer} />
        </div>
      )}
    </div>
  );
}
