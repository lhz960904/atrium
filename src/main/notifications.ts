import { app, Notification } from 'electron';
import type { ScheduledTaskRun } from './db/schema';
import { getSettings } from './settings/conf';

// Main-process UI strings have no i18n framework (the renderer owns react-i18next),
// so a scheduled-run notification carries its own tiny bilingual map — matched to
// the app's language setting, or the OS locale when that's set to "system".
const STRINGS = {
  en: { done: 'Scheduled task completed', failed: 'Scheduled task failed' },
  zh: { done: '定时任务已完成', failed: '定时任务运行失败' },
} as const;

function uiLang(): 'en' | 'zh' {
  try {
    const pref = getSettings('general.language');
    if (pref === 'en' || pref === 'zh') return pref;
  } catch {
    // settings not open yet — fall through to the OS locale
  }
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * Surface a finished scheduled run as a desktop notification. The title is the
 * task's own name (language-neutral); clicking opens the task's bound thread via
 * `onOpen`. No-op where notifications aren't supported. On macOS this needs a
 * code-signed app to emit click events — Atrium ships Developer ID signed.
 */
export function notifyScheduledRun(opts: {
  title: string;
  threadId: string | null;
  status: ScheduledTaskRun['status'];
  onOpen: (threadId: string) => void;
}): void {
  if (!Notification.isSupported()) return;
  const strings = STRINGS[uiLang()];
  const notification = new Notification({
    title: opts.title,
    body: opts.status === 'error' ? strings.failed : strings.done,
  });
  const { threadId } = opts;
  if (threadId) notification.on('click', () => opts.onOpen(threadId));
  notification.show();
}
