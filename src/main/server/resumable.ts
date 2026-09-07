import { type RunLog, withRunLog } from './pi-events';

/**
 * Run lifetime registry — the producer side of a turn. A run writes into the
 * thread's event log decoupled from any client: a renderer disconnect can't
 * cancel generation, and persistence always completes. Reconnecting clients
 * replay the event log (see pi-events), which replaced the old resumable
 * UIMessage SSE store.
 */

type Run = { abort: AbortController };

const runByThread = new Map<string, Run>();

export function getRunningThreadIds(): string[] {
  return [...runByThread.keys()];
}

export function isThreadRunning(threadId: string): boolean {
  return runByThread.has(threadId);
}

/**
 * Abort a thread's in-flight run, if any. Aborting the run's signal ends the
 * loop, which seals the event log and persists whatever was generated. Returns
 * whether a live run was found to abort.
 */
export function abortThreadRun(threadId: string): boolean {
  const run = runByThread.get(threadId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/**
 * Start a thread's run; a newer run on the same thread supersedes this one's
 * registry slot without cancelling it. The thread's event log exists by the time
 * this returns, so a caller can subscribe to it immediately. The returned
 * promise settles when the run has finished and its log is sealed.
 */
export function startThreadRun(
  threadId: string,
  produce: (log: RunLog) => Promise<void>,
  abort: AbortController,
): Promise<void> {
  const token: Run = { abort };
  runByThread.set(threadId, token);
  return withRunLog(threadId, produce).finally(() => {
    if (runByThread.get(threadId) === token) runByThread.delete(threadId);
  });
}
