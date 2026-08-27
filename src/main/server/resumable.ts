import type { UIMessageChunk } from 'ai';
import { drainRunToEventLog } from './pi-events';

/**
 * Run lifetime registry — the producer side of a turn. The engine's chunk
 * stream is drained to completion through the protocol bridge into the
 * thread's event log, decoupled from any client: a renderer disconnect can't
 * cancel generation, and persistence (which fires once the engine stream is
 * fully consumed) always completes. Reconnecting clients replay the event log
 * (see pi-events), which replaced the old resumable UIMessage SSE store.
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
 * Abort a thread's in-flight run, if any. Aborting the agent's signal ends
 * the engine stream, which seals the event log and persists whatever was
 * generated. Returns whether a live run was found to abort.
 */
export function abortThreadRun(threadId: string): boolean {
  const run = runByThread.get(threadId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/** Start a thread's run; a newer run on the same thread supersedes this one's
 *  registry slot without cancelling its drain. */
export function startThreadRun(
  run: { threadId: string; provider: string; model: string },
  stream: ReadableStream<UIMessageChunk>,
  abort: AbortController,
): void {
  const token: Run = { abort };
  runByThread.set(run.threadId, token);
  void drainRunToEventLog(run, stream).finally(() => {
    if (runByThread.get(run.threadId) === token) runByThread.delete(run.threadId);
  });
}
