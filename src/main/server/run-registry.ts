import { generateId, type UIMessageChunk } from 'ai';

type RunState = {
  streamId: string;
  threadId: string;
  /** Every chunk seen so far, so a late subscriber can replay from the start. */
  buffer: UIMessageChunk[];
  done: boolean;
  error: unknown;
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>;
  abort: AbortController;
};

/**
 * In-process registry of active agent runs, one per thread. It decouples a
 * run's lifetime from any single HTTP connection: the producer stream is
 * drained to completion here regardless of who is (or isn't) reading, and the
 * chunks are multicast to any number of subscribers — the original POST and
 * later GET reconnects all attach the same way.
 *
 * This is the single-process equivalent of the resumable-stream + Redis setup
 * the AI SDK docs describe for serverless: in Electron the main process is the
 * persistent buffer, so an in-memory map replaces the external store. A run
 * lives only while it streams; once done it is dropped and post-finish loads
 * come from the DB (the assistant message is persisted on finish).
 */
export class RunRegistry {
  private byThread = new Map<string, RunState>();

  has(threadId: string): boolean {
    const state = this.byThread.get(threadId);
    return state != null && !state.done;
  }

  /**
   * Start a run for a thread and return a subscriber stream for the caller
   * (the POST response). `makeStream` builds the agent's chunk stream around
   * the registry-owned abort signal — never the request signal, so a client
   * disconnect can't cancel the generation. If a run is already in flight for
   * the thread it is aborted and replaced.
   */
  start(
    threadId: string,
    makeStream: (signal: AbortSignal) => Promise<ReadableStream<UIMessageChunk>>,
  ): ReadableStream<UIMessageChunk> {
    this.byThread.get(threadId)?.abort.abort();
    const state: RunState = {
      streamId: generateId(),
      threadId,
      buffer: [],
      done: false,
      error: null,
      subscribers: new Set(),
      abort: new AbortController(),
    };
    this.byThread.set(threadId, state);
    void this.drain(state, makeStream);
    return this.subscribe(state);
  }

  /** A fresh subscriber stream for an active run on the thread, or null. */
  subscribeByThread(threadId: string): ReadableStream<UIMessageChunk> | null {
    const state = this.byThread.get(threadId);
    return state ? this.subscribe(state) : null;
  }

  stop(threadId: string): void {
    this.byThread.get(threadId)?.abort.abort();
  }

  private async drain(
    state: RunState,
    makeStream: (signal: AbortSignal) => Promise<ReadableStream<UIMessageChunk>>,
  ): Promise<void> {
    try {
      const reader = (await makeStream(state.abort.signal)).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        state.buffer.push(value);
        for (const sub of state.subscribers) sub.enqueue(value);
      }
    } catch (err) {
      state.error = err;
    } finally {
      state.done = true;
      for (const sub of state.subscribers) sub.close();
      state.subscribers.clear();
      // Drop only if still the current run — a replacement may have taken over.
      if (this.byThread.get(state.threadId) === state) this.byThread.delete(state.threadId);
    }
  }

  private subscribe(state: RunState): ReadableStream<UIMessageChunk> {
    let self: ReadableStreamDefaultController<UIMessageChunk>;
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        self = controller;
        for (const chunk of state.buffer) controller.enqueue(chunk);
        if (state.done) {
          controller.close();
          return;
        }
        state.subscribers.add(controller);
      },
      cancel: () => {
        state.subscribers.delete(self);
      },
    });
  }
}
