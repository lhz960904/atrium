import { expect, test } from 'bun:test';
import type { AuthMethod } from '@agentclientprotocol/sdk';
import { AcpSessionRegistry, type AcpSpec } from './registry';
import type { AcpSession } from './session';

type FakeSession = AcpSession & { disposed: boolean; resumeArg?: string };

function fakeSession(authMethods: AuthMethod[] = [], sessionId = 'sess'): FakeSession {
  const s = {
    disposed: false,
    resumeArg: undefined as string | undefined,
    async start(_cwd: string, resume?: string) {
      s.resumeArg = resume;
      return { authMethods, sessionId };
    },
    dispose() {
      s.disposed = true;
    },
  };
  return s as unknown as FakeSession;
}

/** A registry whose connect() hands out the queued fake sessions, tracking calls. */
function harness(queue: FakeSession[]) {
  const made: FakeSession[] = [];
  const reg = new AcpSessionRegistry(() => {
    const s = queue.shift() ?? fakeSession();
    made.push(s);
    return s;
  });
  return { reg, made };
}

const spec = (providerId: string): AcpSpec => ({
  providerId,
  command: 'x',
  args: [],
  cwd: '/ws',
});

test('passes the resume id to start and returns the new session id', async () => {
  const s = fakeSession([], 'sess-xyz');
  const { reg } = harness([s]);
  const r = await reg.acquire('t1', spec('claude'), 'prior-123');
  expect(r.ok && r.sessionId).toBe('sess-xyz');
  expect(s.resumeArg).toBe('prior-123');
});

test('reuses the same session for the same thread + provider', async () => {
  const { reg, made } = harness([fakeSession()]);
  const a = await reg.acquire('t1', spec('claude'));
  const b = await reg.acquire('t1', spec('claude'));
  expect(a.ok && b.ok && a.session === b.session).toBe(true);
  expect(made.length).toBe(1); // connected once, reused
});

test('switching provider disposes the old session and starts a new one', async () => {
  const first = fakeSession();
  const { reg, made } = harness([first, fakeSession()]);
  await reg.acquire('t1', spec('claude'));
  await reg.acquire('t1', spec('codex'));
  expect(first.disposed).toBe(true);
  expect(made.length).toBe(2);
});

test('a not-signed-in session is disposed and not cached', async () => {
  const needsAuth = fakeSession([{ id: 'oauth', name: 'Sign in' }]);
  const { reg, made } = harness([needsAuth, fakeSession()]);

  const r = await reg.acquire('t1', spec('codex'));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.authMethods[0].name).toBe('Sign in');
  expect(needsAuth.disposed).toBe(true);

  // Next attempt (e.g. after login) starts a fresh session, not the cached one.
  const r2 = await reg.acquire('t1', spec('codex'));
  expect(r2.ok).toBe(true);
  expect(made.length).toBe(2);
});

test('dispose and disposeAll kill sessions', async () => {
  const s1 = fakeSession();
  const s2 = fakeSession();
  const { reg } = harness([s1, s2]);
  await reg.acquire('t1', spec('claude'));
  await reg.acquire('t2', spec('gemini'));

  reg.dispose('t1');
  expect(s1.disposed).toBe(true);
  expect(s2.disposed).toBe(false);

  reg.disposeAll();
  expect(s2.disposed).toBe(true);
});
