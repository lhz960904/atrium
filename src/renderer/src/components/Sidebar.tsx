import { Link } from '@tanstack/react-router';
import { Archive, ListFilter, Search, Settings, SquarePen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { timeAgo } from '../lib/time';
import { trpc } from '../lib/trpc';
import { useCommandPalette } from '../state/command-palette-store';
import { useSidebarStore } from '../state/sidebar-store';
import { toast } from '../state/toast-store';

const chatRowBase =
  'group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-fg-secondary hover:bg-sidebar-item-hover hover:text-fg-primary';
const chatRowActive =
  'group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm bg-sidebar-item-active text-fg-primary';

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation();
  const width = useSidebarStore((s) => s.width);
  const openPalette = useCommandPalette((s) => s.setOpen);
  const utils = trpc.useUtils();
  const { data: threads, isLoading } = trpc.threads.list.useQuery();
  // Poll the main process for which threads are generating; a small id list, so
  // the interval is cheap (unlike polling message content).
  const { data: running } = trpc.threads.running.useQuery(undefined, { refetchInterval: 2000 });
  const runningSet = new Set(running);
  const archive = trpc.threads.archive.useMutation({
    onSuccess: () => {
      utils.threads.list.invalidate();
      toast.success(t('chat.archived'));
    },
  });

  // A background run has no client mounted to refresh the list when it finishes,
  // so its unread dot would lag until a manual refresh. Watch the polled running
  // set: when a thread drops out of it, it just completed — refetch the list so
  // its bumped updatedAt (vs lastReadAt) surfaces the dot.
  const prevRunning = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(running);
    let finished = false;
    for (const id of prevRunning.current) if (!current.has(id)) finished = true;
    prevRunning.current = current;
    if (finished) utils.threads.list.invalidate();
  }, [running, utils]);

  return (
    <aside
      className="flex h-full min-h-0 select-none flex-col border-r border-border-default bg-surface"
      style={{ width }}
    >
      <div className="atrium-titlebar" />

      <nav className="flex shrink-0 flex-col gap-0.5 px-3 pt-2 pb-1">
        <Link
          to="/"
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <SquarePen className="size-[15px] shrink-0" />
          <span className="flex-1 text-left">{t('home.newChat')}</span>
        </Link>
        <SbNavItem
          icon={<Search className="size-[15px] shrink-0" />}
          label={t('sidebar.search')}
          onClick={() => openPalette(true)}
        />
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SbSection
          label={t('sidebar.chats')}
          hoverActions={
            <>
              <SbIconButton
                title={t('sidebar.sortFilter')}
                icon={<ListFilter className="size-[13px]" />}
              />
              <SbIconButton
                title={t('home.newChat')}
                icon={<SquarePen className="size-[13px]" />}
              />
            </>
          }
        />
        {isLoading ? (
          <div className="px-3 py-1.5 text-fg-disabled text-sm">{t('common.loading')}</div>
        ) : !threads || threads.length === 0 ? (
          <div className="px-3 py-1.5 text-fg-disabled text-sm">{t('sidebar.noChats')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to="/chat/$threadId"
                params={{ threadId: thread.id }}
                className={chatRowBase}
                activeProps={{ className: chatRowActive }}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {thread.title ?? t('common.untitledChat')}
                </span>
                {runningSet.has(thread.id) ? (
                  <span
                    role="status"
                    aria-label={t('sidebar.running')}
                    className="size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent"
                  />
                ) : (
                  // Status indicator yields to a one-click archive button on row hover.
                  <span className="relative flex shrink-0 items-center">
                    <span className="flex items-center group-hover:invisible">
                      {thread.lastReadAt != null &&
                      new Date(thread.updatedAt) > new Date(thread.lastReadAt) ? (
                        <span
                          role="status"
                          aria-label={t('sidebar.unread')}
                          className="size-2 rounded-full bg-accent"
                        />
                      ) : (
                        <span className="text-fg-disabled text-xs">
                          {timeAgo(thread.updatedAt)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      title={t('chat.archive')}
                      aria-label={t('chat.archive')}
                      onClick={(e) => {
                        // Inside the row's <Link>: keep the click from navigating.
                        e.preventDefault();
                        e.stopPropagation();
                        archive.mutate({ id: thread.id });
                      }}
                      className="absolute right-0 hidden rounded p-0.5 text-fg-tertiary hover:bg-elevated hover:text-fg-primary group-hover:block"
                    >
                      <Archive className="size-[13px]" />
                    </button>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border-default px-3 py-2">
        <Link
          to="/settings/$section"
          params={{ section: 'general' }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
        >
          <Settings className="size-[15px] shrink-0" />
          <span>{t('sidebar.settings')}</span>
        </Link>
      </div>
    </aside>
  );
}

function SbNavItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function SbSection({
  label,
  className,
  hoverActions,
}: {
  label: string;
  className?: string;
  hoverActions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`group flex items-center px-3 pt-3 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider ${className ?? ''}`}
    >
      <span className="flex-1">{label}</span>
      <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {hoverActions}
      </span>
    </div>
  );
}

function SbIconButton({
  title,
  icon,
  small = false,
}: {
  title: string;
  icon: React.ReactNode;
  small?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className={`rounded text-fg-tertiary hover:bg-elevated hover:text-fg-primary ${small ? 'p-0.5' : 'p-1'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {icon}
    </button>
  );
}
