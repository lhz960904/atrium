import cronstrue from 'cronstrue';
// Register only the locales we ship (English is built in) — importing
// `cronstrue/i18n` would bundle all ~30 locales (~230 kB more).
import 'cronstrue/locales/zh_CN';
import type { RouterOutputs } from './trpc';

export type ScheduledTask = RouterOutputs['scheduled']['list'][number];
export type ScheduledRun = RouterOutputs['scheduled']['runs'][number];

/** Recurring frequencies the schedule editor offers (plus raw `custom`). */
export type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

export type ScheduleParts = {
  frequency: Frequency;
  hour: number;
  minute: number;
  /** 0=Sun … 6=Sat, for `weekly`. */
  dayOfWeek: number;
  /** 1–31, for `monthly`. */
  dayOfMonth: number;
};

const DEFAULT_PARTS: ScheduleParts = {
  frequency: 'daily',
  hour: 9,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
};

/** Classify a cron string into editable parts; `custom` for anything the presets
 *  don't cover (the editor then shows the raw expression). */
export function parseCron(cronExpr: string | null): ScheduleParts {
  if (!cronExpr) return DEFAULT_PARTS;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_PARTS, frequency: 'custom' };
  const [min, hr, dom, mon, dow] = parts;
  const minute = Number(min);
  const hour = Number(hr);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) {
    return { ...DEFAULT_PARTS, frequency: 'custom' };
  }
  const base = { ...DEFAULT_PARTS, hour, minute };
  if (mon === '*' && dom === '*') {
    if (dow === '*') return { ...base, frequency: 'daily' };
    if (dow === '1-5') return { ...base, frequency: 'weekdays' };
    const d = Number(dow);
    if (Number.isInteger(d) && d >= 0 && d <= 6)
      return { ...base, frequency: 'weekly', dayOfWeek: d };
  }
  if (mon === '*' && dow === '*' && dom !== '*') {
    const dm = Number(dom);
    if (Number.isInteger(dm) && dm >= 1 && dm <= 31) {
      return { ...base, frequency: 'monthly', dayOfMonth: dm };
    }
  }
  return { ...DEFAULT_PARTS, frequency: 'custom' };
}

/** Build a 5-field cron from editable parts (`custom` returns null — the caller
 *  keeps the user's raw expression). */
export function buildCron(p: ScheduleParts): string | null {
  switch (p.frequency) {
    case 'daily':
      return `${p.minute} ${p.hour} * * *`;
    case 'weekdays':
      return `${p.minute} ${p.hour} * * 1-5`;
    case 'weekly':
      return `${p.minute} ${p.hour} * * ${p.dayOfWeek}`;
    case 'monthly':
      return `${p.minute} ${p.hour} ${p.dayOfMonth} * *`;
    default:
      return null;
  }
}

/** app language → cronstrue locale id. */
const CRONSTRUE_LOCALE: Record<'en' | 'zh', string> = { en: 'en', zh: 'zh_CN' };

/**
 * Human-readable recurrence for a cron expression, localized via cronstrue
 * (full cron-syntax coverage + built-in locales). Falls back to the raw pattern
 * if cronstrue can't parse it, so the UI always shows something.
 */
export function describeCron(cronExpr: string, lang: 'en' | 'zh'): string {
  try {
    return cronstrue.toString(cronExpr, {
      locale: CRONSTRUE_LOCALE[lang],
      use24HourTimeFormat: true,
    });
  } catch {
    return cronExpr;
  }
}
