import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeCron, type ScheduledTask } from '../../lib/schedule-format';
import { formatDateTime } from '../../lib/time';

/** One task in the middle list column: title + its schedule (or "Paused"). */
export function TaskRow({
  task,
  active,
  lang,
  onSelect,
}: {
  task: ScheduledTask;
  active: boolean;
  lang: 'en' | 'zh';
  onSelect: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const schedule =
    task.kind === 'recurring' && task.cronExpr
      ? describeCron(task.cronExpr, lang)
      : task.runAt
        ? t('scheduled.onceAt', { when: formatDateTime(task.runAt, lang) })
        : '';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left ${
        active ? 'bg-surface-strong' : 'hover:bg-elevated'
      }`}
    >
      <CalendarClock
        className={`mt-0.5 size-4 shrink-0 ${task.enabled ? 'text-accent' : 'text-fg-disabled'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg-primary text-sm">{task.title}</div>
        <div className="mt-0.5 truncate text-fg-tertiary text-xs">
          {task.enabled ? schedule : `${t('scheduled.statusPaused')} · ${schedule}`}
        </div>
      </div>
    </button>
  );
}
