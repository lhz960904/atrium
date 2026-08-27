import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';
import type { UIMessageChunk } from 'ai';
import { createLogger } from '../log';
import { createProtocolBridge } from './protocol-bridge';

/**
 * The wire's event store: every run's UIMessageChunk stream is folded through
 * the protocol bridge into a per-thread envelope log, and readers replay the
 * buffer from any seq then tail live. This IS the chat transport now — the
 * POST response and every reconnect serve slices of this log.
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

/**
 * Drain the run's chunk stream through the bridge into the thread's log,
 * consuming the source to completion (which is what fires the engine's
 * onFinish persistence). The drain owns closure: whether the source ends,
 * aborts, or errors, the bridge's finalize seals the event sequence and the
 * log ends.
 */
export async function drainRunToEventLog(
  run: { threadId: string; provider: string; model: string },
  stream: ReadableStream<UIMessageChunk>,
): Promise<void> {
  const threadLog = beginLog(run.threadId);
  const bridge = createProtocolBridge({ provider: run.provider, model: run.model });

  const append = (event: AgentSessionEvent) => {
    const envelope: EventEnvelope = { v: 1, seq: threadLog.envelopes.length, event };
    threadLog.envelopes.push(envelope);
    for (const listener of threadLog.listeners) listener(envelope);
  };

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of bridge.push(value)) append(event);
    }
  } catch (err) {
    log.warn(`run stream failed mid-flight: ${err}`);
  } finally {
    for (const event of bridge.finalize()) append(event);
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
