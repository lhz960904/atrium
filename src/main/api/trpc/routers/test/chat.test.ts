import { expect, mock, test } from 'bun:test';
import {
  InteractionConflict,
  InvalidInteractionDecision,
} from '@main/agent/runtime/pending-interactions';
import type { Runner } from '@main/agent/runtime/runner';
import { chatRouter } from '../chat';

/**
 * The router's whole job is translation, so these pin the translation: which
 * inputs never reach the runner, which runner failures become which tRPC code,
 * and that watching a log is separable from the run writing it.
 */

function caller(fake: Partial<Runner>) {
  const start = mock(() => {
    throw new Error('a decision never starts a run');
  });
  return chatRouter.createCaller({ runner: { start, ...fake } as unknown as Runner });
}

const valid = {
  threadId: 't1',
  interaction: {
    runId: 'r1',
    interactionId: '6f1f1c1e-5a4b-4c3d-9e2f-1a2b3c4d5e6f',
    decision: { kind: 'approved' as const },
  },
};

test('a malformed decision is rejected before it reaches the runner', async () => {
  const respond = mock(() => 'accepted' as const);
  const chat = caller({ respond });
  const malformed = [
    {},
    { ...valid, interaction: { ...valid.interaction, interactionId: 'not-a-uuid' } },
    {
      ...valid,
      interaction: { ...valid.interaction, decision: { kind: 'approved', toolName: 'rm' } },
    },
    {
      ...valid,
      interaction: { ...valid.interaction, decision: { kind: 'denied', reason: 'x'.repeat(2001) } },
    },
    {
      ...valid,
      interaction: { ...valid.interaction, decision: { kind: 'answered', answers: [] } },
    },
    {
      ...valid,
      interaction: {
        ...valid.interaction,
        decision: { kind: 'answered', answers: ['a', 'b', 'c', 'd', 'e'] },
      },
    },
    { ...valid, interaction: { ...valid.interaction, arguments: { command: 'rm -rf /' } } },
  ];
  for (const input of malformed) {
    await expect(chat.decide(input as never)).rejects.toThrow();
  }
  expect(respond).not.toHaveBeenCalled();
});

test('an accepted decision reaches the runner and starts nothing', async () => {
  const respond = mock(() => 'accepted' as const);
  const chat = caller({ respond });
  expect(await chat.decide(valid)).toEqual({ status: 'accepted' });
  expect(respond).toHaveBeenCalledWith('t1', valid.interaction);
});

test('a retried decision reports that it was already accepted', async () => {
  const chat = caller({ respond: () => 'already_accepted' });
  expect(await chat.decide(valid)).toEqual({ status: 'already_accepted' });
});

test('a decision for an interaction that is no longer open conflicts', async () => {
  const chat = caller({
    respond: () => {
      throw new InteractionConflict('The interaction is no longer active.');
    },
  });
  await expect(chat.decide(valid)).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('a decision that does not fit its interaction is a bad request', async () => {
  const chat = caller({
    respond: () => {
      throw new InvalidInteractionDecision('A approval cannot be answered.');
    },
  });
  await expect(chat.decide(valid)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('a send that is not a user message never reaches the runner', async () => {
  const start = mock(() => ({ runId: 'r1', settled: Promise.resolve({ status: 'ok' as const }) }));
  const chat = caller({ start } as never);
  await expect(
    chat.send({
      threadId: 't1',
      providerId: 'p',
      modelId: 'm',
      message: { id: 'a1', role: 'assistant', parts: [] } as never,
    }),
  ).rejects.toThrow('user message');
  expect(start).not.toHaveBeenCalled();
});

test('watching a thread with no log completes at once instead of hanging', async () => {
  const chat = caller({ subscribe: () => null });
  const seen: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    void chat.events({ threadId: 't1', from: -1 }).then((observable) =>
      observable.subscribe({
        next: (value) => seen.push(value),
        error: reject,
        complete: resolve,
      }),
    );
  });
  expect(seen).toEqual([]);
});

test('a rejoin does not replay a log whose run has already ended', async () => {
  const subscribe = mock(() => null);
  const chat = caller({ isRunning: () => false, subscribe });
  await new Promise<void>((resolve, reject) => {
    void chat.rejoin({ threadId: 't1', from: -1 }).then((observable) =>
      observable.subscribe({
        next: () => reject(new Error('replayed a finished run')),
        error: reject,
        complete: resolve,
      }),
    );
  });
  // The finished run's message is already in the database the caller seeds from.
  expect(subscribe).not.toHaveBeenCalled();
});

test('detaching a watcher cancels only its own reader, never the run', async () => {
  let cancelled = false;
  const stream = new ReadableStream<never>({
    cancel: () => {
      cancelled = true;
    },
  });
  const abort = mock(() => true);
  const chat = caller({ isRunning: () => true, subscribe: () => stream, abort });

  const observable = await chat.events({ threadId: 't1', from: -1 });
  observable.subscribe({ next: () => {} }).unsubscribe();
  await Bun.sleep(5);

  expect(cancelled).toBe(true);
  // Closing a tab must not be what stops a turn.
  expect(abort).not.toHaveBeenCalled();
});
