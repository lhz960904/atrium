import { describe, expect, test } from 'bun:test';
import type { EventEnvelope } from '@shared/protocol';
import type { UIMessageChunk } from 'ai';
import { drainChunkStream, subscribePiEvents, withRunLog } from '../pi-events';

const textTurn: UIMessageChunk[] = [
  { type: 'start', messageId: 'm1' },
  { type: 'start-step' },
  { type: 'text-start', id: 'b0' },
  { type: 'text-delta', id: 'b0', delta: 'hi' },
  { type: 'text-end', id: 'b0' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' },
];

function streamOf(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Source held closed behind a gate, so a subscriber can attach first. */
function gatedStream(chunks: UIMessageChunk[]) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const stream = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      await gate;
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { stream, open };
}

async function readEnvelopes(sse: ReadableStream<Uint8Array>): Promise<EventEnvelope[]> {
  const text = await new Response(sse).text();
  return text
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as EventEnvelope);
}

const MODEL = { provider: 'deepseek', model: 'deepseek-chat' };

const drainInto = (threadId: string, stream: ReadableStream<UIMessageChunk>) =>
  withRunLog(threadId, (log) => drainChunkStream(log, MODEL, stream));

const drain = (threadId: string, chunks: UIMessageChunk[]) => drainInto(threadId, streamOf(chunks));

describe('pi event log', () => {
  test('an ended log replays fully with contiguous seq and closes', async () => {
    await drain('t-replay', textTurn);
    const sse = subscribePiEvents('t-replay', -1);
    expect(sse).not.toBeNull();
    const envelopes = await readEnvelopes(sse as ReadableStream<Uint8Array>);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes[0]?.event.type).toBe('agent_start');
    expect(envelopes.at(-1)?.event.type).toBe('agent_end');
  });

  test('replay from a seq skips everything at or before it', async () => {
    await drain('t-from', textTurn);
    const all = await readEnvelopes(subscribePiEvents('t-from', -1) as ReadableStream<Uint8Array>);
    const tail = await readEnvelopes(subscribePiEvents('t-from', 4) as ReadableStream<Uint8Array>);
    expect(tail).toEqual(all.filter((e) => e.seq > 4));
  });

  test('a mid-run subscriber gets replay plus live tail with no gap', async () => {
    const { stream, open } = gatedStream(textTurn);
    const draining = drainInto('t-live', stream);
    // Subscribe while the run is parked before its first chunk, then let it flow.
    const sse = subscribePiEvents('t-live', -1);
    expect(sse).not.toBeNull();
    open();
    await draining;
    const envelopes = await readEnvelopes(sse as ReadableStream<Uint8Array>);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, i) => i));
    expect(envelopes.at(-1)?.event.type).toBe('agent_end');
  });

  test('a source error still seals the log', async () => {
    const broken = new ReadableStream<UIMessageChunk>({
      async start(controller) {
        controller.enqueue({ type: 'start', messageId: 'm1' });
        controller.enqueue({ type: 'start-step' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.error(new Error('engine exploded'));
      },
    });
    await drainInto('t-err', broken);
    const envelopes = await readEnvelopes(
      subscribePiEvents('t-err', -1) as ReadableStream<Uint8Array>,
    );
    expect(envelopes.at(-1)?.event.type).toBe('agent_end');
    expect(envelopes.filter((e) => e.event.type === 'message_end')).toHaveLength(1);
  });

  test('a new run supersedes the thread log', async () => {
    await drain('t-super', textTurn);
    await drain('t-super', [
      { type: 'start', messageId: 'm2' },
      { type: 'start-step' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const envelopes = await readEnvelopes(
      subscribePiEvents('t-super', -1) as ReadableStream<Uint8Array>,
    );
    expect(envelopes[0]?.seq).toBe(0);
    const starts = envelopes.filter((e) => e.event.type === 'message_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.event).toMatchObject({ messageId: 'm2' });
  });

  test('unknown threads subscribe to null', () => {
    expect(subscribePiEvents('t-none', -1)).toBeNull();
  });
});
