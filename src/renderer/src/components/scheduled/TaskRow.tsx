import { CalendarClock, Pencil, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeCron, type ScheduledTask } from '../../lib/schedule-format';
import { formatDateTime } from '../../lib/time';
import { trpc } from '../../lib/trpc';
import { toast } from '../../state/toast-store';

/**
 * One task in the list. Shows title, schedule and next-run; on hover reveals
 * quick actions (run now / edit / delete). Run-now and delete are colocated
 * here since they act on this row; edit just opens the detail drawer.
 */
export function TaskRow({
  task,
  lang,
  onOpen,
}: {
  task: ScheduledTask;
  lang: 'en' | 'zh';
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const runNow = trpc.scheduled.runNow.useMutation({
    onSuccess: (data) => {
      if (data.started) {
        toast.success({ key: 'scheduled.startedToast' });
        utils.scheduled.runs.invalidate({ id: task.id });
      } else {
        toast.info({ key: 'scheduled.alreadyRunningToast' });
      }
    },
  });
  const del = trpc.scheduled.delete.useMutation({
    onSuccess: () => utils.scheduled.list.invalidate(),
  });

  const schedule =
    task.kind === 'recurring' && task.cronExpr
      ? describeCron(task.cronExpr, lang)
      : task.runAt
        ? t('scheduled.onceAt', { when: formatDateTime(task.runAt, lang) })
        : '';
  const subline = task.enabled ? schedule : `${t('scheduled.statusPaused')} · ${schedule}`;
  const next =
    task.enabled && task.nextRunAt
      ? t('scheduled.nextShort', { when: formatDateTime(task.nextRunAt, lang) })
      : null;

  return (
    <div className="group flex items-center gap-2.5 rounded-lg px-3 py-2.5 hover:bg-elevated">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
      >
        <CalendarClock
          className={`mt-0.5 size-4 shrink-0 ${task.enabled ? 'text-accent' : 'text-fg-disabled'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-fg-primary text-sm">{task.title}</div>
          <div className="mt-0.5 truncate text-fg-tertiary text-xs">
            {subline}
            {next && <span className="text-fg-disabled"> · {next}</span>}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <RowAction
          title={t('scheduled.runNow')}
          onClick={() => runNow.mutate({ id: task.id })}
          disabled={runNow.isLoading}
        >
          <Play className="size-4" />
        </RowAction>
        <RowAction title={t('scheduled.edit')} onClick={onOpen}>
          <Pencil className="size-4" />
        </RowAction>
        <RowAction
          title={t('scheduled.delete')}
          danger
          onClick={() => {
            if (window.confirm(t('scheduled.deleteConfirm'))) del.mutate({ id: task.id });
          }}
        >
          <Trash2 className="size-4" />
        </RowAction>
      </div>
    </div>
  );
}

function RowAction({
  title,
  danger,
  disabled,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong disabled:opacity-40 ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}
