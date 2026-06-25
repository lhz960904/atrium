import type { AtriumUIMessage } from '@shared/chat';
import type { ClarifyResult, Todo } from '@shared/chat-types';
import type { AtriumTools } from '@shared/tools';
import { type ChatStatus, getStaticToolName, isStaticToolUIPart } from 'ai';
import { ArrowDown, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStickToBottom } from 'use-stick-to-bottom';
import type { PendingApproval } from '../../lib/approvals';
import { useAutoReviewStore } from '../../state/auto-review-store';
import { useCompactionStore } from '../../state/compaction-store';
import { useImageGenStore } from '../../state/image-gen-store';
import { ApprovalCard } from './ApprovalCard';
import { AssistantMessage } from './AssistantMessage';
import { AutoReviewToast } from './AutoReviewToast';
import { ChatHeader } from './ChatHeader';
import { CompactionDivider, CompactionProgress } from './CompactionDivider';
import type { Attachment } from './composer/AttachmentChip';
import { Composer } from './composer/Composer';
import { ProjectBadge } from './composer/ProjectBadge';
import type { SlashCommand } from './composer/slash-menu';
import { TokenCounter } from './composer/TokenCounter';
import { ImageGeneratingProgress } from './ImageGeneratingProgress';
import { PlanPanel } from './PlanPanel';
import { TurnLoading } from './TurnLoading';
import { UserMessage } from './UserMessage';

type ChatThreadProps = {
  threadId: string;
  /** The thread's project (its working directory), or null for projectless. */
  projectId: string | null;
  title: string;
  messages: AtriumUIMessage[];
  status: ChatStatus;
  /** The turn's failure, if any — surfaced as an error notice. */
  error?: Error;
  /** The thread's active plan (latest todo_write); null when none. */
  plan: Todo[] | null;
  /** Tool calls awaiting an approval decision; the first shows above the composer. */
  approvals: PendingApproval[];
  /** `/` commands for the composer (e.g. compact). */
  commands: SlashCommand[];
  onSend: (text: string, attachments: Attachment[]) => void;
  /** Approve / trust-always / deny a pending tool call (resumes or aborts it). */
  onApprove: (approvalId: string) => void;
  onAlways: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
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

/** Whether the last message is an assistant turn already showing something —
 *  once it is, the standalone loader yields to the message itself. */
function lastAssistantHasContent(messages: AtriumUIMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant') return false;
  return last.parts.some(
    (p) =>
      ((p.type === 'text' || p.type === 'reasoning') && p.text.trim() !== '') ||
      p.type === 'file' ||
      p.type === 'dynamic-tool' ||
      isStaticToolUIPart(p),
  );
}

export function ChatThread({
  threadId,
  projectId,
  title,
  messages,
  status,
  error,
  plan,
  approvals,
  commands,
  onSend,
  onApprove,
  onAlways,
  onDeny,
  onClarify,
  onCancelClarify,
  onStop,
}: ChatThreadProps): React.JSX.Element {
  const { t } = useTranslation();
  // Compaction is a live, per-thread status in a global store — read it here
  // rather than threading it through as a prop.
  const compacting = useCompactionStore((s) => s.active[threadId] ?? false);
  const generatingImage = useImageGenStore((s) => s.active[threadId] ?? false);
  const live = status === 'submitted' || status === 'streaming';
  const pendingClarify = pendingClarifyId(messages);
  const clarifyPending = pendingClarify !== null;
  const approvalPending = approvals.length > 0;
  const lastId = messages.at(-1)?.id;
  // The head of this thread's auto-review notice queue; each toast self-dismisses.
  const autoReviewToast = useAutoReviewStore((s) => s.toasts[threadId]?.[0]);

  // Keep the assistant side non-blank from send until the message starts
  // producing content.
  const preloader = live && !generatingImage && !compacting && !lastAssistantHasContent(messages);

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

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: 'instant',
  });

  return (
    <div className="flex h-full flex-col">
      <ChatHeader threadId={threadId} title={title} />
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          <div ref={contentRef} className="mx-auto max-w-[760px] px-2 py-6">
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
            {preloader && <TurnLoading />}
            {error && (
              <div className="my-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-danger text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 whitespace-pre-wrap break-words">{error.message}</span>
              </div>
            )}
          </div>
        </div>
        {!isAtBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="-translate-x-1/2 absolute bottom-4 left-1/2 flex size-9 items-center justify-center rounded-full border border-border-default bg-elevated text-fg-secondary opacity-60 shadow-md transition-opacity hover:text-fg-primary hover:opacity-100"
          >
            <ArrowDown className="size-5" />
          </button>
        )}
      </div>
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px]">
          {/* An approval takes the slot alone — the plan panel hides until it resolves. */}
          {plan != null && !approvalPending && <PlanPanel todos={plan} />}
          {approvalPending && (
            <ApprovalCard
              key={approvals[0].approvalId}
              approval={approvals[0]}
              more={approvals.length - 1}
              onApprove={onApprove}
              onAlways={onAlways}
              onDeny={onDeny}
            />
          )}
          {/* Auto-review notice yields to a real approval (they never co-occur). */}
          {!approvalPending && autoReviewToast && (
            <AutoReviewToast
              key={autoReviewToast.id}
              subject={autoReviewToast.subject}
              onDone={() =>
                useAutoReviewStore.getState().dismissToast(threadId, autoReviewToast.id)
              }
            />
          )}
          <Composer
            disabled={live || compacting || clarifyPending || approvalPending}
            streaming={live}
            placeholder={
              clarifyPending
                ? t('composer.holdClarify')
                : approvalPending
                  ? t('composer.holdApproval')
                  : undefined
            }
            attachedTop={plan != null || approvalPending || (!approvalPending && !!autoReviewToast)}
            commands={commands}
            onSubmit={onSend}
            onStop={onStop}
            toolbarLeft={<ProjectBadge projectId={projectId} />}
            toolbarStatus={<TokenCounter messages={messages} />}
          />
        </div>
      </div>
    </div>
  );
}
