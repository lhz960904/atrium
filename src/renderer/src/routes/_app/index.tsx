import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Handshake, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '../../components/chat/composer/AttachmentChip';
import { Composer } from '../../components/chat/composer/Composer';
import { timeAgo } from '../../lib/time';
import { trpc } from '../../lib/trpc';
import { useStartOnboarding } from '../../lib/use-onboarding';
import { usePendingInput } from '../../state/pending-input-store';

/** How many recent chats the home "continue" list shows. */
const RECENT_LIMIT = 5;

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
  const { data: displayName } = trpc.profile.displayName.useQuery();
  const { data: needsOnboarding } = trpc.profile.needsOnboarding.useQuery();
  const timeGreeting = t(greetingFor(new Date().getHours()));
  const greeting = displayName
    ? t('home.greeting', { greeting: timeGreeting, name: displayName })
    : t('home.greetingNoName', { greeting: timeGreeting });
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: threads } = trpc.threads.list.useQuery();
  const { data: running } = trpc.threads.running.useQuery(undefined, { refetchInterval: 2000 });
  const runningSet = new Set(running);
  const recent = (threads ?? []).slice(0, RECENT_LIMIT);

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

  const { start: startOnboarding, isPending: onboardingPending } = useStartOnboarding();

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6 py-10">
      {/* No header bar here; top strip keeps the window draggable over empty space. */}
      <div className="app-drag absolute inset-x-0 top-0 h-9" />
      <div className="flex w-full max-w-[680px] flex-col items-stretch gap-6">
        {/* Greeting */}
        <h1 className="text-center font-semibold text-[32px] text-fg-primary tracking-tight">
          {greeting}
        </h1>

        {/* Composer */}
        <Composer autoFocus onSubmit={handleSubmit} disabled={createThread.isLoading} />

        {/* First run: invite the user to get acquainted (writes SOUL.md / USER.md). */}
        {needsOnboarding && (
          <button
            type="button"
            onClick={startOnboarding}
            disabled={onboardingPending}
            className="flex w-full items-center gap-3 rounded-lg border border-border-default px-3 py-2.5 text-left hover:border-accent hover:bg-surface"
          >
            <Handshake className="size-[15px] shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-fg-primary text-sm">{t('home.getAcquaintedTitle')}</div>
              <div className="truncate text-fg-tertiary text-xs">{t('home.getAcquaintedSub')}</div>
            </div>
          </button>
        )}

        {/* Continue from — most recent chats */}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pt-3 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
              {t('home.continue')}
            </div>
            {recent.map((thread) => (
              <Link
                key={thread.id}
                to="/chat/$threadId"
                params={{ threadId: thread.id }}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-border-default hover:bg-surface"
              >
                <MessageCircle className="size-[15px] shrink-0 text-fg-tertiary" />
                <div className="min-w-0 flex-1 truncate text-fg-primary text-sm">
                  {thread.title ?? t('common.untitledChat')}
                </div>
                {runningSet.has(thread.id) ? (
                  <span
                    role="status"
                    aria-label={t('sidebar.running')}
                    className="size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent"
                  />
                ) : (
                  <span className="shrink-0 text-fg-disabled text-xs">
                    {timeAgo(thread.updatedAt)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
