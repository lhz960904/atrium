import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';

/**
 * One run's event log. The run appends envelopes; readers replay from any seq
 * and then tail live. Readers get envelopes — how they are framed for a
 * transport is the caller's business.
 *
 * A reader is its own stream's controller, so replaying, tailing and ending all
 * go through one object: there is a single set to keep, and a reader that goes
 * away is removed in one place rather than unregistered from two.
 *
 * The entry points are bound, so a run can be handed `emit` alone without
 * carrying the log it writes to.
 */
export class EventBuffer {
  private readonly envelopes: EventEnvelope[] = [];
  private readonly readers = new Set<ReadableStreamDefaultController<EventEnvelope>>();
  private ended = false;

  /** Whether the run that writes this log has finished. */
  get closed(): boolean {
    return this.ended;
  }

  /** Append one event and hand it to every live reader. */
  emit = (event: AgentSessionEvent): void => {
    if (this.ended) return;
    const envelope: EventEnvelope = { seq: this.envelopes.length, event };
    this.envelopes.push(envelope);
    for (const reader of this.readers) reader.enqueue(envelope);
  };

  /** Seal the log: tailing readers end, and later events are ignored. */
  close = (): void => {
    if (this.ended) return;
    this.ended = true;
    for (const reader of this.readers) reader.close();
    this.readers.clear();
  };

  /**
   * Envelopes with seq > fromSeq, replay then live tail. The snapshot and the
   * reader's registration happen in the same synchronous start(), so no event
   * can fall into the gap between them. A sealed log replays fully and closes,
   * which keeps a finished run inspectable until it is superseded or evicted.
   */
  subscribe = (fromSeq: number): ReadableStream<EventEnvelope> => {
    let reader: ReadableStreamDefaultController<EventEnvelope> | undefined;
    return new ReadableStream({
      start: (controller) => {
        for (const envelope of this.envelopes) {
          if (envelope.seq > fromSeq) controller.enqueue(envelope);
        }
        if (this.ended) {
          controller.close();
          return;
        }
        reader = controller;
        this.readers.add(controller);
      },
      cancel: () => {
        if (reader) this.readers.delete(reader);
      },
    });
  };
}
