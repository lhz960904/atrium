import { describe, expect, test } from 'bun:test';
import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';
import { EventBuffer } from '../../stream/run-event-buffer';

const turn = (runId: string): AgentSessionEvent[] => [
  { type: 'run_started', runId },
  { type: 'agent_start' },
  { type: 'turn_start' },
  { type: 'message_start', message: { role: 'user', content: '', timestamp: 0 } },
  { type: 'message_end', message: { role: 'user', content: 'hi', timestamp: 0 } },
  { type: 'turn_end' },
  { type: 'agent_end' },
  { type: 'run_finished', status: 'completed' },
];

async function readEnvelopes(stream: ReadableStream<EventEnvelope>): Promise<EventEnvelope[]> {
  const envelopes: EventEnvelope[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    envelopes.push(value);
  }
  return envelopes;
}

const types = (envelopes: EventEnvelope[]) => envelopes.map((e) => e.event.type);

/** A log the run already finished writing. */
function ran(events: AgentSessionEvent[]): EventBuffer {
  const buffer = new EventBuffer();
  for (const event of events) buffer.emit(event);
  buffer.close();
  return buffer;
}

describe('event buffer', () => {
  test('a run that emitted nothing leaves an empty, closed log', async () => {
    const buffer = new EventBuffer();
    expect(buffer.closed).toBe(false);
    buffer.close();
    expect(buffer.closed).toBe(true);
    expect(await readEnvelopes(buffer.subscribe(-1))).toEqual([]);
  });

  test('ignores late events from background work after the log closes', async () => {
    const buffer = new EventBuffer();
    buffer.emit({ type: 'agent_end' });
    buffer.close();
    buffer.emit({ type: 'notice', name: 'title', payload: { data: { title: 'Late title' } } });
    expect(types(await readEnvelopes(buffer.subscribe(-1)))).toEqual(['agent_end']);
  });

  test('an ended log replays fully with contiguous seq and closes', async () => {
    const envelopes = await readEnvelopes(ran(turn('m1')).subscribe(-1));
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes[0]?.event.type).toBe('run_started');
    expect(envelopes.at(-1)?.event.type).toBe('run_finished');
  });

  test('replay from a seq skips everything at or before it', async () => {
    const buffer = ran(turn('m1'));
    const all = await readEnvelopes(buffer.subscribe(-1));
    expect(await readEnvelopes(buffer.subscribe(2))).toEqual(all.filter((e) => e.seq > 2));
  });

  test('a mid-run subscriber gets replay plus live tail with no gap', async () => {
    const buffer = new EventBuffer();
    buffer.emit({ type: 'run_started', runId: 'm1' });

    // Subscribe after the run's first event, then let the rest flow.
    const stream = buffer.subscribe(-1);
    for (const event of turn('m1').slice(1)) buffer.emit(event);
    buffer.close();

    const envelopes = await readEnvelopes(stream);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes.at(-1)?.event.type).toBe('run_finished');
  });

  test('a reader that goes away stops being written to', async () => {
    const buffer = new EventBuffer();
    buffer.emit({ type: 'run_started', runId: 'm1' });
    const reader = buffer.subscribe(-1).getReader();
    expect((await reader.read()).value?.event.type).toBe('run_started');
    await reader.cancel();

    // The log keeps going for everyone else.
    buffer.emit({ type: 'agent_end' });
    buffer.close();
    expect(types(await readEnvelopes(buffer.subscribe(-1)))).toEqual(['run_started', 'agent_end']);
  });

  test('its entry points work detached from the instance', async () => {
    const { emit, close, subscribe } = new EventBuffer();
    emit({ type: 'agent_start' });
    close();
    expect(types(await readEnvelopes(subscribe(-1)))).toEqual(['agent_start']);
  });
});
