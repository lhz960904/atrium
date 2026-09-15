import { createRunEventBuffer, type RunEventWriter } from './stream/run-event-buffer';

/** Owns active runs and their replay buffers for one Runner instance. */
export function createRunCoordinator() {
  const active = new Map<string, AbortController>();
  const events = createRunEventBuffer();
  let disposed = false;

  function assertAvailable(threadId: string) {
    if (disposed) throw new Error('Runner is disposed');
    if (active.has(threadId)) throw new Error(`Thread ${threadId} is already running`);
  }

  function start(
    threadId: string,
    produce: (events: RunEventWriter) => Promise<void>,
    abort: AbortController,
  ): Promise<void> {
    assertAvailable(threadId);
    active.set(threadId, abort);
    return events.produce(threadId, produce).finally(() => {
      active.delete(threadId);
    });
  }

  function abort(threadId: string): boolean {
    const controller = active.get(threadId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  return {
    start,
    assertAvailable,
    abort,
    isRunning: (threadId: string) => active.has(threadId),
    runningThreadIds: () => [...active.keys()],
    subscribe: events.subscribe,
    dispose() {
      disposed = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}
