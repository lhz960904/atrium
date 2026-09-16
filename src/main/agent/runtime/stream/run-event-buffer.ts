import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';

/**
 * The wire's event store: a run appends its events to the thread's envelope
 * log, and readers replay the buffer from any seq then tail live. Readers get
 * envelopes; how they are framed for a transport is the caller's business.
 *
 * Memory bounds: one log per thread, superseded by the thread's next run, and
 * ended logs beyond a fixed count are evicted oldest-first. A single log holds
 * exactly one run.
 */

type ThreadLog = {
  envelopes: EventEnvelope[];
  listeners: Set<(envelope: EventEnvelope) => void>;
  onEnd: Set<() => void>;
  ended: boolean;
};

const MAX_FINISHED_LOGS = 64;

/** Each coordinator owns its buffers; separate runners never share state. */
export function createRunEventBuffer() {
  const logs = new Map<string, ThreadLog>();

  function beginLog(threadId: string): ThreadLog {
    const fresh: ThreadLog = {
      envelopes: [],
      listeners: new Set(),
      onEnd: new Set(),
      ended: false,
    };
    // Reinsert so Map order stays usable as an LRU for evicting finished logs.
    logs.delete(threadId);
    logs.set(threadId, fresh);
    for (const [id, threadLog] of logs) {
      if (logs.size <= MAX_FINISHED_LOGS) break;
      if (threadLog.ended) logs.delete(id);
    }
    return fresh;
  }

  /**
   * Open a fresh log for the thread, superseding whatever it held. Creation is
   * synchronous so the run's first event cannot precede a reader handed out at
   * admission. The owner must close it whatever the run did: a reader tailing
   * the log has to see it end.
   */
  function begin(threadId: string): RunEventLog {
    const threadLog = beginLog(threadId);
    return {
      emit(event) {
        if (threadLog.ended) return;
        const envelope: EventEnvelope = { seq: threadLog.envelopes.length, event };
        threadLog.envelopes.push(envelope);
        for (const listener of threadLog.listeners) listener(envelope);
      },
      close() {
        if (threadLog.ended) return;
        threadLog.ended = true;
        for (const fn of threadLog.onEnd) fn();
        threadLog.listeners.clear();
        threadLog.onEnd.clear();
      },
    };
  }

  /**
   * A thread's envelopes with seq > fromSeq, replay then live tail; null when
   * the thread has no log. Snapshot and listener registration happen in the
   * same synchronous start(), so no event can fall into the gap between replay
   * and tail. An ended log replays fully and closes — that keeps a finished run
   * inspectable until its log is superseded or evicted.
   */
  function subscribe(threadId: string, fromSeq: number): ReadableStream<EventEnvelope> | null {
    const threadLog = logs.get(threadId);
    if (!threadLog) return null;
    let detach: (() => void) | undefined;

    return new ReadableStream({
      start(controller) {
        const send = (envelope: EventEnvelope) => controller.enqueue(envelope);
        for (const envelope of threadLog.envelopes) {
          if (envelope.seq > fromSeq) send(envelope);
        }
        if (threadLog.ended) {
          controller.close();
          return;
        }
        const close = () => {
          detach?.();
          controller.close();
        };
        threadLog.listeners.add(send);
        threadLog.onEnd.add(close);
        detach = () => {
          threadLog.listeners.delete(send);
          threadLog.onEnd.delete(close);
        };
      },
      cancel() {
        detach?.();
      },
    });
  }

  return { begin, subscribe };
}

/** A run's write end of its replay buffer. */
export type RunEventLog = {
  emit: (event: AgentSessionEvent) => void;
  /** Seal the log: tailing readers end, and later events are ignored. */
  close: () => void;
};
