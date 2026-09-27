import type { ScheduledTaskRun } from '@main/db/schema';
import { Notification } from 'electron';
import { uiLang } from './locale';

const STRINGS = {
  en: { done: 'Scheduled task completed', failed: 'Scheduled task failed' },
  zh: { done: '定时任务已完成', failed: '定时任务运行失败' },
} as const;

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
