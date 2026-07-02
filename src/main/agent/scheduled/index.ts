import { powerMonitor } from 'electron';
import { type ScheduledManagerDeps, scheduledManager } from './manager';

export type {
  CreateScheduledTaskInput,
  ScheduledManagerDeps,
  UpdateScheduledTaskInput,
} from './manager';
export { ScheduledTaskManager, scheduledManager } from './manager';

/**
 * Wire the scheduler into the app: register every enabled task's croner job and
 * catch up anything missed while the app was closed, then re-run that pass on
 * wake — a machine that slept through a fire time comes back here. Call once at
 * boot, after the chat server is listening (start() may fire a caught-up run
 * immediately, which needs the endpoint).
 */
export function startScheduledTasks(deps: ScheduledManagerDeps): void {
  scheduledManager.init(deps);
  scheduledManager.start();
  powerMonitor.on('resume', () => scheduledManager.start());
}
