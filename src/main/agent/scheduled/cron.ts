import { Cron } from 'croner';
import type { ScheduledTask } from '../../db/schema';

/**
 * Schedule helpers over croner. A recurring task carries a 5-field cron string;
 * a once task carries an absolute `runAt`. croner resolves fire times through
 * the `Intl` API, so cron patterns are DST-correct in the task's timezone. A
 * `Cron` built without a callback never schedules a timer — it's just a pattern
 * evaluator, which is how we compute `nextRun` for persistence and previews.
 */

/** True if `expr` is a cron pattern croner can parse. */
export function isValidCron(expr: string): boolean {
  try {
    new Cron(expr);
    return true;
  } catch {
    return false;
  }
}

/** The task's next fire time at/after `from`, or null when nothing is left to run. */
export function computeNextRun(
  task: Pick<ScheduledTask, 'kind' | 'cronExpr' | 'runAt' | 'timezone'>,
  from: Date,
): Date | null {
  if (task.kind === 'once') {
    return task.runAt && task.runAt.getTime() > from.getTime() ? task.runAt : null;
  }
  if (!task.cronExpr) return null;
  try {
    return new Cron(task.cronExpr, { timezone: task.timezone }).nextRun(from);
  } catch {
    return null;
  }
}

/** Cron pattern builders for the presets the UI and the agent tool expose. All
 *  take 24-hour local time in the task's timezone. */
export const cronPattern = {
  everyDayAt: (hour: number, minute: number): string => `${minute} ${hour} * * *`,
  everyWeekdayAt: (hour: number, minute: number): string => `${minute} ${hour} * * 1-5`,
  /** dayOfWeek: 0=Sun … 6=Sat. */
  everyWeekAt: (dayOfWeek: number, hour: number, minute: number): string =>
    `${minute} ${hour} * * ${dayOfWeek}`,
  /** dayOfMonth: 1–31 (or 'L' for last, which croner understands). */
  everyMonthAt: (dayOfMonth: number | 'L', hour: number, minute: number): string =>
    `${minute} ${hour} ${dayOfMonth} * *`,
  everyHour: (): string => '0 * * * *',
};

// Human-readable schedule text is NOT produced here: the renderer describes a
// cron via `cronstrue` (full cron-syntax coverage + built-in locales, mapping
// the app language en/zh → cronstrue en/zh_CN). croner stays the single parser
// for validation + scheduling; cronstrue only formats for display.
