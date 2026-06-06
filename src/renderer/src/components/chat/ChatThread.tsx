import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult, Todo } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { type ChatStatus, getStaticToolName, isStaticToolUIPart } from 'ai';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCompactionStore } from '../../state/compaction-store';
import { useImageGenStore } from '../../state/image-gen-store';
import { AssistantMessage } from './AssistantMessage';
import { ChatHeader } from './ChatHeader';
import { CompactionDivider, CompactionProgress } from './CompactionDivider';
import type { Attachment } from './composer/AttachmentChip';
import { Composer } from './composer/Composer';
import type { SlashCommand } from './composer/slash-menu';
import { ImageGeneratingProgress } from './ImageGeneratingProgress';
import { PlanPanel } from './PlanPanel';
import { UserMessage } from './UserMessage';

type ChatThreadProps = {
  threadId: string;
  title: string;
  messages: AtriumUIMessage[];
  status: ChatStatus;
  /** The turn's failure, if any — surfaced as an error notice. */
  error?: Error;
  /** The thread's active plan (latest todo_write); null when none. */
  plan: Todo[] | null;
  /** `/` commands for the composer (e.g. compact). */
  commands: SlashCommand[];
  onSend: (text: string, attachments: Attachment[]) => void;
  /** Submit a clarification's answers (addToolOutput); resumes the turn. */
  onClarify: (toolCallId: string, result: ClarifyResult) => void;
  /** Dismiss a clarification without answering; resolves it but doesn't resume. */
  onCancelClarify: (toolCallId: string) => void;
  /** Stop the in-flight generation. */
  onStop: () => void;
};

function messageText(parts: AtriumUIMessage['parts']): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** The toolCallId of an ask_clarification awaiting its answer, or null. The
 *  composer is held while one is pending so the dangling tool call can't strand
 *  the next turn; Esc cancels it. */
function pendingClarifyId(messages: AtriumUIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (
        isStaticToolUIPart(p) &&
        getStaticToolName<AtriumTools>(p) === 'ask_clarification' &&
        p.state === 'input-available'
      ) {
        return p.toolCallId;
      }
    }
  }
  return null;
}

export function ChatThread({
  threadId,
  title,
  messages,
  status,
  error,
  plan,
  commands,
  onSend,
  onClarify,
  onCancelClarify,
  onStop,
}: ChatThreadProps): React.JSX.Element {
  // Compaction is a live, per-thread status in a global store — read it here
  // rather than threading it through as a prop.
  const compacting = useCompactionStore((s) => s.active[threadId] ?? false);
  const generatingImage = useImageGenStore((s) => s.active[threadId] ?? false);
  const live = status === 'submitted' || status === 'streaming';
  const pendingClarify = pendingClarifyId(messages);
  const clarifyPending = pendingClarify !== null;
  const lastId = messages.at(-1)?.id;

  // Esc takes back the turn (Claude Code style): aborts an in-flight generation,
  // or cancels a clarification that's waiting on the user. Bound only while one
  // of those is active, so it doesn't swallow Esc from popovers/menus otherwise.
  useEffect(() => {
    if (!live && !clarifyPending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (live) onStop();
      else if (pendingClarify) onCancelClarify(pendingClarify);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, clarifyPending, pendingClarify, onStop, onCancelClarify]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Pin the view to the newest content as it streams — unless the user has
  // scrolled up to read earlier messages, in which case leave them be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is the intended trigger to re-pin on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <div className="flex h-full flex-col">
      <ChatHeader title={title} />
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-2 py-6">
          {messages.map((msg) => {
            const kind = msg.metadata?.kind;
            // The ack is an internal alternation placeholder — never shown.
            if (kind === 'compaction-ack') return null;
            if (kind === 'compaction') {
              return <CompactionDivider key={msg.id} summary={messageText(msg.parts)} />;
            }
            return msg.role === 'user' ? (
              <UserMessage key={msg.id} parts={msg.parts} />
            ) : (
              <AssistantMessage
                key={msg.id}
                message={msg}
                streaming={live && msg.id === lastId}
                onAnswer={onClarify}
                onCancel={onCancelClarify}
              />
            );
          })}
          {compacting && <CompactionProgress />}
          {generatingImage && <ImageGeneratingProgress />}
          {error && (
            <div className="my-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-danger text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 whitespace-pre-wrap break-words">{error.message}</span>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px]">
          {plan != null && <PlanPanel todos={plan} />}
          <Composer
            disabled={live || compacting || clarifyPending}
            streaming={live}
            placeholder={clarifyPending ? '请先回答上面的问题…' : undefined}
            attachedTop={plan != null}
            commands={commands}
            onSubmit={onSend}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  );
}
