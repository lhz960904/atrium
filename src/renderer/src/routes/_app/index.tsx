import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FileText, FolderClosed, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '../../components/chat/composer/AttachmentChip';
import { Composer } from '../../components/chat/composer/Composer';
import { MOCK_CONTINUE_ITEMS, MOCK_CURRENT_PROJECT } from '../../lib/mock-data';
import { trpc } from '../../lib/trpc';
import { usePendingInput } from '../../state/pending-input-store';

export const Route = createFileRoute('/_app/')({
  component: HomeView,
});

function greetingFor(
  hour: number,
):
  | 'home.greetingNight'
  | 'home.greetingMorning'
  | 'home.greetingNoon'
  | 'home.greetingAfternoon'
  | 'home.greetingEvening' {
  if (hour < 5) return 'home.greetingNight';
  if (hour < 11) return 'home.greetingMorning';
  if (hour < 13) return 'home.greetingNoon';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function HomeView(): React.JSX.Element {
  const { t } = useTranslation();
  const greeting = t('home.greeting', {
    greeting: t(greetingFor(new Date().getHours())),
    name: '昊泽',
  });
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  // Create an empty thread, stash the typed text as a draft, then navigate;
  // the chat view auto-sends the draft once its model is ready.
  const createThread = trpc.threads.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.threads.list.invalidate();
      navigate({ to: '/chat/$threadId', params: { threadId: id } });
    },
  });

  const handleSubmit = (text: string, attachments: Attachment[]): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 && attachments.length === 0) return;
    usePendingInput.getState().set({ text: trimmed, attachments });
    const title = trimmed || attachments[0]?.name || t('home.newChat');
    createThread.mutate({ title: title.slice(0, 60) });
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 py-10">
      {/* No header bar here; top strip keeps the window draggable over empty space. */}
      <div className="app-drag absolute inset-x-0 top-0 h-9" />
      <div className="flex w-full max-w-[680px] flex-col items-stretch gap-6">
        {/* Project chip */}
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-fg-secondary text-sm">
            <FolderClosed className="size-3.5 text-fg-tertiary" />
            <span>{MOCK_CURRENT_PROJECT.name}</span>
            <span className="text-fg-disabled">· {MOCK_CURRENT_PROJECT.chatCount} chats</span>
          </div>
        </div>

        {/* Greeting */}
        <h1 className="text-center font-semibold text-[32px] text-fg-primary tracking-tight">
          {greeting}
        </h1>

        {/* Composer */}
        <Composer autoFocus onSubmit={handleSubmit} disabled={createThread.isLoading} />

        {/* Continue from */}
        {MOCK_CONTINUE_ITEMS.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pt-3 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
              {t('home.continue')}
            </div>
            {MOCK_CONTINUE_ITEMS.map((item) => (
              <button
                type="button"
                key={item.id}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-border-default hover:bg-surface"
              >
                {item.kind === 'artifact' ? (
                  <FileText className="size-[15px] shrink-0 text-fg-tertiary" />
                ) : (
                  <MessageCircle className="size-[15px] shrink-0 text-fg-tertiary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg-primary text-sm">{item.name}</div>
                  <div className="truncate text-fg-tertiary text-xs">{item.sub}</div>
                </div>
                {item.kind === 'chat-running' ? (
                  <span
                    role="status"
                    aria-label={t('sidebar.running')}
                    className="size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent"
                  />
                ) : (
                  <span className="shrink-0 text-fg-disabled text-xs">{item.ago}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
