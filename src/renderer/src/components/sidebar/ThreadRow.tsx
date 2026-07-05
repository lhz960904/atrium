import { Link } from '@tanstack/react-router';
import { Archive, Clock, Pin, PinOff } from 'lucide-react';
import { memo } from 'react';
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

type ThreadRowProps = { thread: ThreadItem; running: boolean; hasSchedule: boolean };

// updatedAt / lastReadAt come back as fresh values on every refetch (Date
// instances at runtime, though typed as ISO strings), so compare by time value
// — reference (===) never matches. new Date() accepts both forms; null is a
// valid lastReadAt (never read), so guard it first.
const sameTime = (a: string | null, b: string | null): boolean =>
  a == null || b == null ? a === b : new Date(a).getTime() === new Date(b).getTime();

/**
 * Opening a chat refetches the sidebar's thread list (a chat open can flip the
 * running set or land a model-generated title), and the query layer returns
 * fresh object identities even for rows whose data is unchanged — so a
 * reference-equality memo would still re-render all 200-ish rows (and their
 * radix-tooltip subtrees) on every chat switch. Compare the fields the row
 * actually renders instead, so an unchanged row truly bails out.
 */
function threadRowPropsEqual(a: ThreadRowProps, b: ThreadRowProps): boolean {
  return (
    a.running === b.running &&
    a.hasSchedule === b.hasSchedule &&
    a.thread.id === b.thread.id &&
    a.thread.title === b.thread.title &&
    a.thread.pinned === b.thread.pinned &&
    sameTime(a.thread.updatedAt, b.thread.updatedAt) &&
    sameTime(a.thread.lastReadAt, b.thread.lastReadAt)
  );
}

export const ThreadRow = memo(function ThreadRow({
  thread,
  running,
  hasSchedule,
}: ThreadRowProps): React.JSX.Element {
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
}, threadRowPropsEqual);
