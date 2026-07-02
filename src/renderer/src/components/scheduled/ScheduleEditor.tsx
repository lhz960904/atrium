import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import { describeCron, type ScheduledTask } from '../../lib/schedule-format';
import { DateTimePicker } from './DateTimePicker';

/** The schedule fields update() accepts (runAt as epoch millis, per the router). */
export type SchedulePatch = {
  kind: 'recurring' | 'once';
  cronExpr: string | null;
  runAt: number | null;
};

const inputClass =
  'w-full rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-fg-primary text-sm outline-0 focus:border-accent';

/**
 * Inline schedule editor: a recurring task is a raw cron expression with a live
 * human-readable preview (via cronstrue) plus preset quick-fills; a one-time task
 * is an absolute datetime. Every change emits a SchedulePatch (autosave) — the
 * parent runs the update mutation, which validates and toasts on error.
 */
export function ScheduleEditor({
  task,
  lang,
  onChange,
}: {
  task: ScheduledTask;
  lang: 'en' | 'zh';
  onChange: (patch: SchedulePatch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'recurring' | 'once'>(task.kind);
  const [cron, setCron] = useState(task.cronExpr ?? '0 9 * * *');
  const [runAt, setRunAt] = useState<Date | null>(task.runAt ? new Date(task.runAt) : null);

  const emitRecurring = (c: string): void =>
    onChange({ kind: 'recurring', cronExpr: c.trim() || null, runAt: null });
  const emitOnce = (d: Date | null): void =>
    onChange({ kind: 'once', cronExpr: null, runAt: d ? d.getTime() : null });

  const preview = cron.trim() ? describeCron(cron.trim(), lang) : '';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Select
          value={kind}
          onChange={(v) => {
            setKind(v);
            if (v === 'recurring') emitRecurring(cron);
            else if (runAt) emitOnce(runAt);
          }}
          options={[
            { value: 'recurring', label: t('scheduled.kindRecurring') },
            { value: 'once', label: t('scheduled.kindOnce') },
          ]}
          aria-label={t('scheduled.repeats')}
        />
        <div className="min-w-0 flex-1">
          {kind === 'recurring' ? (
            <input
              type="text"
              value={cron}
              spellCheck={false}
              placeholder="0 9 * * *"
              onChange={(e) => setCron(e.target.value)}
              onBlur={() => emitRecurring(cron)}
              aria-label={t('scheduled.cronLabel')}
              className={`${inputClass} font-mono`}
            />
          ) : (
            <DateTimePicker
              value={runAt}
              lang={lang}
              onChange={(d) => {
                setRunAt(d);
                emitOnce(d);
              }}
            />
          )}
        </div>
      </div>
      {kind === 'recurring' && preview && <p className="text-fg-tertiary text-xs">{preview}</p>}
    </div>
  );
}
