import { expect, mock, test } from 'bun:test';
import {
  InteractionConflict,
  InvalidInteractionDecision,
} from '@main/agent/runtime/pending-interactions';
import type { Runner } from '@main/agent/runtime/runner';
import { createChatApp } from '../http';

const TOKEN = 'launch-token';

function chatApp(respond: Runner['respond']) {
  const start = mock(() => {
    throw new Error('a decision never starts a run');
  });
  const runner = { respond, start } as unknown as Runner;
  return { app: createChatApp({ token: TOKEN, runner }), start };
}

const post = (body: unknown, token: string | null = TOKEN) => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token === null ? {} : { 'x-atrium-token': token }),
  },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const valid = {
  runId: 'r1',
  interactionId: '6f1f1c1e-5a4b-4c3d-9e2f-1a2b3c4d5e6f',
  decision: { kind: 'approved' },
};

test('a decision without the launch token is refused', async () => {
  const respond = mock(() => 'accepted' as const);
  const { app } = chatApp(respond);
  expect((await app.request('/api/chat/t1/decisions', post(valid, null))).status).toBe(401);
  expect((await app.request('/api/chat/t1/decisions', post(valid, 'guess'))).status).toBe(401);
  expect(respond).not.toHaveBeenCalled();
});

test('a malformed decision is rejected before it reaches the runner', async () => {
  const respond = mock(() => 'accepted' as const);
  const { app } = chatApp(respond);
  const malformed = [
    '{',
    {},
    { ...valid, interactionId: 'not-a-uuid' },
    { ...valid, decision: { kind: 'approved', toolName: 'rm' } },
    { ...valid, decision: { kind: 'denied', reason: 'x'.repeat(2001) } },
    { ...valid, decision: { kind: 'answered', answers: [] } },
    { ...valid, decision: { kind: 'answered', answers: ['a', 'b', 'c', 'd', 'e'] } },
    { ...valid, arguments: { command: 'rm -rf /' } },
  ];
  for (const body of malformed) {
    expect((await app.request('/api/chat/t1/decisions', post(body))).status).toBe(400);
  }
  expect(respond).not.toHaveBeenCalled();
});

test('an oversized body is refused', async () => {
  const respond = mock(() => 'accepted' as const);
  const { app } = chatApp(respond);
  const body = { ...valid, decision: { kind: 'denied', reason: 'x'.repeat(70 * 1024) } };
  expect((await app.request('/api/chat/t1/decisions', post(body))).status).toBe(413);
  expect(respond).not.toHaveBeenCalled();
});

test('an accepted decision reaches the runner and starts nothing', async () => {
  const respond = mock(() => 'accepted' as const);
  const { app, start } = chatApp(respond);
  const res = await app.request('/api/chat/t1/decisions', post(valid));
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ status: 'accepted' });
  expect(respond).toHaveBeenCalledWith('t1', valid);
  expect(start).not.toHaveBeenCalled();
});

test('a retried decision reports that it was already accepted', async () => {
  const { app } = chatApp(() => 'already_accepted');
  const res = await app.request('/api/chat/t1/decisions', post(valid));
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ status: 'already_accepted' });
});

test('a decision for an interaction that is no longer open conflicts', async () => {
  const { app } = chatApp(() => {
    throw new InteractionConflict('The interaction is no longer active.');
  });
  expect((await app.request('/api/chat/t1/decisions', post(valid))).status).toBe(409);
});

test('a decision that does not fit its interaction is a bad request', async () => {
  const { app } = chatApp(() => {
    throw new InvalidInteractionDecision('A approval cannot be answered.');
  });
  expect((await app.request('/api/chat/t1/decisions', post(valid))).status).toBe(400);
});

test('decisions no longer resume a run through a second endpoint', async () => {
  const { app, start } = chatApp(() => 'accepted');
  expect((await app.request('/api/chat/t1/resume', post(valid))).status).toBe(404);
  expect(start).not.toHaveBeenCalled();
});
