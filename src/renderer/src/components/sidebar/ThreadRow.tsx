import { Link } from '@tanstack/react-router';
import { Archive, Clock, Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { timeAgo } from '../../lib/time';
import { trpc } from '../../lib/trpc';
import { toast } from '../../state/toast-store';
import { Tooltip } from '../Tooltip';
import { RowAction } from './primitives';
import type { ThreadItem } from './types';

const chatRowBase =
  'group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-fg-secondary hover:bg-sidebar-item-hover hover:text-fg-primary cursor-default';
const chatRowActive =
  'group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm bg-sidebar-item-active text-fg-primary';

export function ThreadRow({
  thread,
  running,
  hasSchedule,
}: {
  thread: ThreadItem;
  running: boolean;
  hasSchedule: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const refresh = (): void => {
    utils.threads.list.invalidate();
  };
  const archive = trpc.threads.archive.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(t('chat.archived'));
    },
  });
  const pin = trpc.threads.pin.useMutation({ onSuccess: refresh });
  const unpin = trpc.threads.unpin.useMutation({ onSuccess: refresh });

  const unread =
    thread.lastReadAt != null && new Date(thread.updatedAt) > new Date(thread.lastReadAt);
  return (
    <Link
      to="/chat/$threadId"
      params={{ threadId: thread.id }}
      className={chatRowBase}
      activeProps={{ className: chatRowActive }}
    >
      <span className="min-w-0 flex-1 truncate text-left">
        {thread.title ?? t('common.untitledChat')}
      </span>
      {running ? (
        <span
          role="status"
          aria-label={t('sidebar.running')}
          className="size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border-strong border-t-accent"
        />
      ) : (
        // Status indicator yields to the hover actions (pin / archive).
        <span className="relative flex shrink-0 items-center">
          <span className="flex items-center group-hover:invisible">
            {unread ? (
              <span
                role="status"
                aria-label={t('sidebar.unread')}
                className="size-2 rounded-full bg-accent"
              />
            ) : (
              <span className="text-fg-disabled text-xs">{timeAgo(thread.updatedAt)}</span>
            )}
          </span>
          <span className="absolute right-0 hidden items-center gap-0.5 group-hover:flex">
            {hasSchedule && (
              <Tooltip content={t('sidebar.scheduled')}>
                <span className="flex items-center p-0.5 text-fg-tertiary">
                  <Clock className="size-[13px]" />
                </span>
              </Tooltip>
            )}
            <RowAction
              title={thread.pinned ? t('sidebar.unpin') : t('sidebar.pin')}
              icon={
                thread.pinned ? <PinOff className="size-[13px]" /> : <Pin className="size-[13px]" />
              }
              onClick={() => (thread.pinned ? unpin : pin).mutate({ id: thread.id })}
            />
            <RowAction
              title={t('chat.archive')}
              icon={<Archive className="size-[13px]" />}
              onClick={() => archive.mutate({ id: thread.id })}
            />
          </span>
        </span>
      )}
    </Link>
  );
}
