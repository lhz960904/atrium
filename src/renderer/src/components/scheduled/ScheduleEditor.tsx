import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import {
  buildCron,
  type Frequency,
  parseCron,
  type ScheduledTask,
} from '../../lib/schedule-format';

type Mode = Frequency | 'once';

/** The schedule fields update() accepts (runAt as epoch millis, per the router). */
export type SchedulePatch = {
  kind: 'recurring' | 'once';
  cronExpr: string | null;
  runAt: number | null;
};

type EditorState = {
  mode: Mode;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cron: string;
  /** datetime-local string, e.g. "2026-07-03T15:00". */
  runAt: string;
};

const pad = (n: number): string => String(n).padStart(2, '0');

function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initFromTask(task: ScheduledTask): EditorState {
  const p = parseCron(task.cronExpr);
  return {
    mode: task.kind === 'once' ? 'once' : p.frequency,
    hour: p.hour,
    minute: p.minute,
    dayOfWeek: p.dayOfWeek,
    dayOfMonth: p.dayOfMonth,
    cron: task.cronExpr ?? '',
    runAt: task.runAt ? toDatetimeLocal(new Date(task.runAt)) : '',
  };
}

function toPatch(s: EditorState): SchedulePatch {
  if (s.mode === 'once') {
    return { kind: 'once', cronExpr: null, runAt: s.runAt ? new Date(s.runAt).getTime() : null };
  }
  if (s.mode === 'custom') {
    return { kind: 'recurring', cronExpr: s.cron.trim() || null, runAt: null };
  }
  return {
    kind: 'recurring',
    cronExpr: buildCron({ ...s, frequency: s.mode }),
    runAt: null,
  };
}

const inputClass =
  'rounded-md border border-border-default bg-surface px-2 py-1.5 text-fg-primary text-sm outline-0 focus:border-accent';

/**
 * Inline schedule editor for the detail panel. Presets build a 5-field cron;
 * "once" takes an absolute datetime; "custom" takes a raw cron. Every change
 * emits a full SchedulePatch (autosave) — the parent runs the update mutation.
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
  const [s, setS] = useState<EditorState>(() => initFromTask(task));

  const update = (partial: Partial<EditorState>): void => {
    const next = { ...s, ...partial };
    setS(next);
    // Custom mode commits on the cron input's blur; switching to it before an
    // expression is typed shouldn't wipe the schedule to an empty cron.
    if (next.mode === 'custom' && !next.cron.trim()) return;
    onChange(toPatch(next));
  };

  const modeOptions: ReadonlyArray<{ value: Mode; label: string }> = [
    { value: 'daily', label: t('scheduled.freq.daily') },
    { value: 'weekdays', label: t('scheduled.freq.weekdays') },
    { value: 'weekly', label: t('scheduled.freq.weekly') },
    { value: 'monthly', label: t('scheduled.freq.monthly') },
    { value: 'once', label: t('scheduled.freq.once') },
    { value: 'custom', label: t('scheduled.freq.custom') },
  ];

  // Locale weekday names; Jan 1 2023 is a Sunday, so index 0=Sun … 6=Sat.
  const weekdayOptions = Array.from({ length: 7 }, (_, i) => ({
    value: String(i),
    label: new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(2023, 0, 1 + i)),
  }));
  const domOptions = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  const timed =
    s.mode === 'daily' || s.mode === 'weekdays' || s.mode === 'weekly' || s.mode === 'monthly';

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={s.mode}
        onChange={(v) => update({ mode: v })}
        options={modeOptions}
        aria-label={t('scheduled.repeats')}
      />

      {timed && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            value={`${pad(s.hour)}:${pad(s.minute)}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (Number.isInteger(h) && Number.isInteger(m)) update({ hour: h, minute: m });
            }}
            className={inputClass}
          />
          {s.mode === 'weekly' && (
            <Select
              value={String(s.dayOfWeek)}
              onChange={(v) => update({ dayOfWeek: Number(v) })}
              options={weekdayOptions}
              aria-label={t('scheduled.freq.weekly')}
            />
          )}
          {s.mode === 'monthly' && (
            <Select
              value={String(s.dayOfMonth)}
              onChange={(v) => update({ dayOfMonth: Number(v) })}
              options={domOptions}
              aria-label={t('scheduled.freq.monthly')}
            />
          )}
        </div>
      )}

      {s.mode === 'once' && (
        <input
          type="datetime-local"
          value={s.runAt}
          onChange={(e) => update({ runAt: e.target.value })}
          className={inputClass}
        />
      )}

      {s.mode === 'custom' && (
        <input
          type="text"
          value={s.cron}
          spellCheck={false}
          placeholder="0 8 * * 1-5"
          onChange={(e) => setS({ ...s, cron: e.target.value })}
          onBlur={() => onChange(toPatch(s))}
          className={`${inputClass} font-mono`}
        />
      )}
    </div>
  );
}
