import { expect, test } from 'bun:test';
import type { ToolCall } from '@earendil-works/pi-ai';
import {
  createPendingInteractions,
  InteractionConflict,
  InvalidInteractionDecision,
} from '../pending-interactions';

const bash: ToolCall = { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } };

const ask = (count: number): ToolCall => ({
  type: 'toolCall',
  id: 'c2',
  name: 'ask_clarification',
  arguments: {
    questions: Array.from({ length: count }, (_, index) => ({
      header: `Q${index}`,
      question: `Question ${index}?`,
      inputType: 'text',
    })),
  },
});

function inbox() {
  const abort = new AbortController();
  return { abort, pending: createPendingInteractions({ runId: 'r1', abort }) };
}

test('one decision wins and identical retries do not execute anything', async () => {
  const { pending } = inbox();
  const waiting = pending.open('approval', bash);
  const input = {
    runId: 'r1',
    interactionId: waiting.request.id,
    decision: { kind: 'approved' as const },
  };
  expect(pending.respond(input)).toBe('accepted');
  expect(pending.respond(input)).toBe('already_accepted');
  await expect(waiting.response).resolves.toEqual({ kind: 'approved' });
  expect(() => pending.respond({ ...input, decision: { kind: 'denied' } })).toThrow(
    InteractionConflict,
  );
  pending.dispose();
});

test('a request carries its run and the original call', () => {
  const { pending } = inbox();
  const { request } = pending.open('approval', bash);
  expect(request).toMatchObject({ runId: 'r1', kind: 'approval', toolCall: bash });
  pending.dispose();
});

test('a decision has to fit the kind of interaction it answers', () => {
  const { pending } = inbox();
  const approval = pending.open('approval', bash);
  const question = pending.open('clarification', ask(1));
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: approval.request.id,
      decision: { kind: 'answered', answers: ['x'] },
    }),
  ).toThrow(InvalidInteractionDecision);
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: question.request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InvalidInteractionDecision);
  pending.dispose();
});

test('answers have to match the questions that were asked', async () => {
  const { pending } = inbox();
  const question = pending.open('clarification', ask(2));
  const answer = (answers: string[]) =>
    pending.respond({
      runId: 'r1',
      interactionId: question.request.id,
      decision: { kind: 'answered', answers },
    });
  expect(() => answer(['only one'])).toThrow(InvalidInteractionDecision);
  expect(answer(['first', 'second'])).toBe('accepted');
  await expect(question.response).resolves.toEqual({
    kind: 'answered',
    answers: ['first', 'second'],
  });
  pending.dispose();
});

test('a decision for another run or an unknown interaction conflicts', () => {
  const { pending } = inbox();
  const waiting = pending.open('approval', bash);
  expect(() =>
    pending.respond({
      runId: 'r2',
      interactionId: waiting.request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: crypto.randomUUID(),
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  pending.dispose();
});

test('cancelling a clarification also cancels the run', async () => {
  const { abort, pending } = inbox();
  const question = pending.open('clarification', ask(1));
  pending.respond({
    runId: 'r1',
    interactionId: question.request.id,
    decision: { kind: 'cancelled' },
  });
  await expect(question.response).resolves.toEqual({ kind: 'cancelled' });
  expect(abort.signal.aborted).toBe(true);
  expect(abort.signal.reason).toBe('clarification_cancelled');
  pending.dispose();
});

test('a cancelled run settles its waits and rejects a late approval', async () => {
  const { abort, pending } = inbox();
  const waiting = pending.open('approval', bash);
  pending.cancel('user_cancelled');
  await expect(waiting.response).resolves.toEqual({
    kind: 'interrupted',
    reason: 'user_cancelled',
  });
  expect(abort.signal.aborted).toBe(true);
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: waiting.request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  pending.dispose();
});

test('a run that is already cancelled opens nothing to decide', async () => {
  const { pending } = inbox();
  pending.cancel('user_cancelled');
  const waiting = pending.open('approval', bash);
  await expect(waiting.response).resolves.toEqual({
    kind: 'interrupted',
    reason: 'user_cancelled',
  });
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: waiting.request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  pending.dispose();
});

test('an internal failure is kept even after the user cancelled', () => {
  const { pending } = inbox();
  pending.cancel('user_cancelled');
  const failure = new Error('session write failed');
  pending.cancel(failure);
  expect(pending.failure).toBe(failure);
  pending.dispose();
});

test('withdrawing one request leaves the others open', async () => {
  const { pending } = inbox();
  const withdrawn = pending.open('approval', bash);
  const other = pending.open('approval', { ...bash, id: 'c3' });
  withdrawn.cancel();
  await expect(withdrawn.response).resolves.toEqual({ kind: 'interrupted', reason: 'interrupted' });
  expect(() =>
    pending.respond({
      runId: 'r1',
      interactionId: withdrawn.request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  expect(
    pending.respond({
      runId: 'r1',
      interactionId: other.request.id,
      decision: { kind: 'approved' },
    }),
  ).toBe('accepted');
  pending.dispose();
});

test('dispose settles open waits and forgets accepted decisions', async () => {
  const { pending } = inbox();
  const decided = pending.open('approval', bash);
  const open = pending.open('approval', { ...bash, id: 'c3' });
  const input = {
    runId: 'r1',
    interactionId: decided.request.id,
    decision: { kind: 'approved' as const },
  };
  pending.respond(input);
  pending.dispose();
  await expect(open.response).resolves.toEqual({ kind: 'interrupted', reason: 'interrupted' });
  expect(() => pending.respond(input)).toThrow(InteractionConflict);
});
