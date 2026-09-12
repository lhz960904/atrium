import { randomUUID } from 'node:crypto';
import type { Db } from '@main/db';
import type { ScheduledTask } from '@main/db/schema';
import { scheduledTaskRuns } from '@main/db/schema';
import { createLogger } from '@main/log';
import type { AtriumUIMessage } from '@shared/chat';
import type { SelectedModel } from '@shared/settings';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Runner } from '../runtime/runner';

const log = createLogger('scheduled');

export type ScheduledRunResult = {
  status: 'ok' | 'error';
  error?: string;
  /** The assistant message this run produced in the bound thread, if any. */
  messageId?: string;
};

/**
 * Keep macOS App Nap / OS suspension from freezing a headless run mid-turn.
 * Electron is required lazily so the manager's import graph stays testable
 * outside an Electron context; a non-Electron context degrades to a no-op.
 */
function blockSuspension(): () => void {
  try {
    const { powerSaveBlocker } = require('electron') as typeof import('electron');
    const id = powerSaveBlocker.start('prevent-app-suspension');
    return () => {
      if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);
    };
  } catch {
    return () => {};
  }
}

/** Start time of the task's most recent *completed* run (excludes the current
 *  in-flight one, which has no finishedAt yet). Undefined on the first run. */
function lastCompletedRunAt(db: Db, taskId: string): Date | undefined {
  return db
    .select({ startedAt: scheduledTaskRuns.startedAt })
    .from(scheduledTaskRuns)
    .where(and(eq(scheduledTaskRuns.taskId, taskId), isNotNull(scheduledTaskRuns.finishedAt)))
    .orderBy(desc(scheduledTaskRuns.startedAt))
    .limit(1)
    .get()?.startedAt;
}

/**
 * Fire one scheduled task headlessly: append the task prompt as a user turn to
 * the task's bound thread and run it on the same runner the chat endpoint uses.
 * The run reports its own outcome, which is what drives the task's
 * consecutive-failure auto-pause; the messages are persisted by the run itself.
 */
export async function runScheduledTask(
  deps: { db: Db; runner: Runner; defaultModel: () => SelectedModel | null },
  task: ScheduledTask,
): Promise<ScheduledRunResult> {
  if (!task.threadId) return { status: 'error', error: 'Scheduled task has no bound thread.' };
  const model =
    task.providerId && task.modelId
      ? { providerId: task.providerId, modelId: task.modelId }
      : deps.defaultModel();
  if (!model) {
    return { status: 'error', error: 'No model configured for this scheduled task.' };
  }

  // A Codex-style key:value preamble frames the turn as an automation run. The
  // Instruction line is our own: each fire appends to the bound thread, so the
  // model sees prior runs and would otherwise reply "already done" and skip.
  // (Automation memory — a per-task memory file — is deferred to V2.)
  const lastRun = lastCompletedRunAt(deps.db, task.id);
  const header = [
    `Automation: ${task.title}`,
    `Automation ID: ${task.id}`,
    `Last run: ${lastRun ? `${lastRun.toISOString()} (${lastRun.getTime()})` : 'never'}`,
    'Instruction: This is a fresh automated run — carry out the task now. Earlier messages in this conversation are previous runs, for context only; do not skip because it was done before.',
  ].join('\n');
  const message: AtriumUIMessage = {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: `${header}\n\n${task.prompt}` }],
  };

  const release = blockSuspension();
  try {
    const outcome = await deps.runner.start({
      threadId: task.threadId,
      providerId: model.providerId,
      modelId: model.modelId,
      permissionMode: task.permissionMode,
      userMessage: message,
    }).settled;
    if (outcome.status === 'error') {
      log.error(`task ${task.id} run failed: ${outcome.error}`);
    }
    return { status: outcome.status, error: outcome.error, messageId: outcome.messageId };
  } catch (err) {
    // A request the runner refuses outright (an unresolvable model) throws
    // before the run ever starts.
    log.error(`task ${task.id} could not start`, err);
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  } finally {
    release();
  }
}
