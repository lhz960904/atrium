import { describe, expect, test } from 'bun:test';
import type { AgentSessionEvent, EventEnvelope } from '@shared/protocol';
import { subscribePiEvents, withRunLog } from '../pi-events';

const turn = (messageId: string): AgentSessionEvent[] => [
  { type: 'agent_start' },
  { type: 'turn_start' },
  { type: 'message_start', messageId, message: { role: 'user', content: '', timestamp: 0 } },
  { type: 'message_end', messageId, message: { role: 'user', content: 'hi', timestamp: 0 } },
  { type: 'turn_end' },
  { type: 'agent_end', willRetry: false },
];

async function readEnvelopes(sse: ReadableStream<Uint8Array>): Promise<EventEnvelope[]> {
  const text = await new Response(sse).text();
  return text
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as EventEnvelope);
}

const replay = (threadId: string, from = -1) =>
  readEnvelopes(subscribePiEvents(threadId, from) as ReadableStream<Uint8Array>);

const run = (threadId: string, events: AgentSessionEvent[]) =>
  withRunLog(threadId, async (log) => {
    for (const event of events) log.append(event);
  });

describe('pi event log', () => {
  test('an ended log replays fully with contiguous seq and closes', async () => {
    await run('t-replay', turn('m1'));
    const envelopes = await replay('t-replay');
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes[0]?.event.type).toBe('agent_start');
    expect(envelopes.at(-1)?.event.type).toBe('agent_end');
  });

  test('replay from a seq skips everything at or before it', async () => {
    await run('t-from', turn('m1'));
    const all = await replay('t-from');
    expect(await replay('t-from', 2)).toEqual(all.filter((e) => e.seq > 2));
  });

  test('a mid-run subscriber gets replay plus live tail with no gap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = withRunLog('t-live', async (log) => {
      log.append({ type: 'agent_start' });
      await gate;
      for (const event of turn('m1').slice(1)) log.append(event);
    });

    // Subscribe while the run is parked after its first event, then let it flow.
    const sse = subscribePiEvents('t-live', -1);
    expect(sse).not.toBeNull();
    release();
    await running;

    const envelopes = await readEnvelopes(sse as ReadableStream<Uint8Array>);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes.at(-1)?.event.type).toBe('agent_end');
  });

  test('a run that threw still seals the log', async () => {
    await withRunLog('t-err', async (log) => {
      log.append({ type: 'agent_start' });
      throw new Error('engine exploded');
    });
    const envelopes = await replay('t-err');
    expect(envelopes).toHaveLength(1);
    // Sealed: the log is ended, so the stream closes rather than hanging live.
    expect(envelopes[0]?.event.type).toBe('agent_start');
  });

  test('a new run supersedes the thread log', async () => {
    await run('t-super', turn('m1'));
    await run('t-super', turn('m2'));
    const envelopes = await replay('t-super');
    expect(envelopes[0]?.seq).toBe(0);
    const starts = envelopes.filter((e) => e.event.type === 'message_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.event).toMatchObject({ messageId: 'm2' });
  });

  test('unknown threads subscribe to null', () => {
    expect(subscribePiEvents('t-none', -1)).toBeNull();
  });
});
