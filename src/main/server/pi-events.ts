import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';
import { createLogger } from '../log';

/**
 * The wire's event store: a run appends its events to the thread's envelope
 * log, and readers replay the buffer from any seq then tail live. This IS the
 * chat transport — the POST response and every reconnect serve slices of it.
 *
 * Memory bounds: one log per thread, superseded by the thread's next run, and
 * ended logs beyond a fixed count are evicted oldest-first. A single log holds
 * one run — the same per-run bound the old resumable store accepted.
 */

const log = createLogger('pi-events');

type ThreadLog = {
  envelopes: EventEnvelope[];
  listeners: Set<(envelope: EventEnvelope) => void>;
  onEnd: Set<() => void>;
  ended: boolean;
};

const logs = new Map<string, ThreadLog>();
const MAX_FINISHED_LOGS = 64;

function beginLog(threadId: string): ThreadLog {
  const fresh: ThreadLog = { envelopes: [], listeners: new Set(), onEnd: new Set(), ended: false };
  // Reinsert so Map order stays usable as an LRU for evicting finished logs.
  logs.delete(threadId);
  logs.set(threadId, fresh);
  for (const [id, threadLog] of logs) {
    if (logs.size <= MAX_FINISHED_LOGS) break;
    if (threadLog.ended) logs.delete(id);
  }
  return fresh;
}

/** A run's write end of its thread's log. */
export type RunLog = { append: (event: AgentSessionEvent) => void };

/**
 * Run one producer against a fresh log for the thread, and close the log
 * whatever the producer did. Closure is the point: a reader tailing the log
 * must always see it end, so a producer that throws still seals the stream.
 */
export async function withRunLog(
  threadId: string,
  produce: (log: RunLog) => Promise<void>,
): Promise<void> {
  const threadLog = beginLog(threadId);
  const append = (event: AgentSessionEvent) => {
    const envelope: EventEnvelope = { v: 1, seq: threadLog.envelopes.length, event };
    threadLog.envelopes.push(envelope);
    for (const listener of threadLog.listeners) listener(envelope);
  };
  try {
    await produce({ append });
  } catch (err) {
    log.warn(`run failed mid-flight: ${err}`);
  } finally {
    threadLog.ended = true;
    for (const fn of threadLog.onEnd) fn();
    threadLog.listeners.clear();
    threadLog.onEnd.clear();
  }
}

/**
 * SSE byte stream of a thread's envelopes with seq > fromSeq, replay then live
 * tail; null when the thread has no log. Snapshot and listener registration
 * happen in the same synchronous start(), so no event can fall into the gap
 * between replay and tail. An ended log replays fully and closes — that keeps
 * a finished run inspectable until its log is superseded or evicted.
 */
export function subscribePiEvents(
  threadId: string,
  fromSeq: number,
): ReadableStream<Uint8Array> | null {
  const threadLog = logs.get(threadId);
  if (!threadLog) return null;
  const encoder = new TextEncoder();
  let detach: (() => void) | undefined;

  return new ReadableStream({
    start(controller) {
      const send = (envelope: EventEnvelope) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
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
