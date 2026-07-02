import cronstrue from 'cronstrue';
// Register only the locales we ship (English is built in) — importing
// `cronstrue/i18n` would bundle all ~30 locales (~230 kB more).
import 'cronstrue/locales/zh_CN';
import type { RouterOutputs } from './trpc';

export type ScheduledTask = RouterOutputs['scheduled']['list'][number];
export type ScheduledRun = RouterOutputs['scheduled']['runs'][number];

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
