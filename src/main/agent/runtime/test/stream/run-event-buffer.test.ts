import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';
import { createRunEventBuffer } from '../../stream/run-event-buffer';

let buffer: ReturnType<typeof createRunEventBuffer>;
beforeEach(() => {
  buffer = createRunEventBuffer();
});

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

const replay = (threadId: string, from = -1) =>
  readEnvelopes(buffer.subscribe(threadId, from) as ReadableStream<EventEnvelope>);

const run = (threadId: string, events: AgentSessionEvent[]) => {
  const log = buffer.begin(threadId);
  for (const event of events) log.emit(event);
  log.close();
};

describe('run event buffer', () => {
  test('a run that emitted nothing leaves an empty, closed log', async () => {
    buffer.begin('t-result').close();
    expect(await replay('t-result')).toEqual([]);
  });

  test('ignores late events from background work after the stream closes', async () => {
    const log = buffer.begin('t-closed');
    log.emit({ type: 'agent_end' });
    log.close();
    log.emit({ type: 'notice', name: 'title', payload: { data: { title: 'Late title' } } });
    expect((await replay('t-closed')).map((frame) => frame.event.type)).toEqual(['agent_end']);
  });

  test('an ended log replays fully with contiguous seq and closes', async () => {
    run('t-replay', turn('m1'));
    const envelopes = await replay('t-replay');
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes[0]?.event.type).toBe('run_started');
    expect(envelopes.at(-1)?.event.type).toBe('run_finished');
  });

  test('replay from a seq skips everything at or before it', async () => {
    run('t-from', turn('m1'));
    const all = await replay('t-from');
    expect(await replay('t-from', 2)).toEqual(all.filter((e) => e.seq > 2));
  });

  test('a mid-run subscriber gets replay plus live tail with no gap', async () => {
    const log = buffer.begin('t-live');
    log.emit({ type: 'run_started', runId: 'm1' });

    // Subscribe after the run's first event, then let the rest flow.
    const sse = buffer.subscribe('t-live', -1);
    expect(sse).not.toBeNull();
    for (const event of turn('m1').slice(1)) log.emit(event);
    log.close();

    const envelopes = await readEnvelopes(sse as ReadableStream<EventEnvelope>);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes.at(-1)?.event.type).toBe('run_finished');
  });

  test('a new run supersedes the thread log', async () => {
    run('t-super', turn('m1'));
    run('t-super', turn('m2'));
    const envelopes = await replay('t-super');
    expect(envelopes[0]?.seq).toBe(0);
    const starts = envelopes.filter((e) => e.event.type === 'run_started');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.event).toMatchObject({ runId: 'm2' });
  });

  test('unknown threads subscribe to null', () => {
    expect(buffer.subscribe('t-none', -1)).toBeNull();
  });
});
