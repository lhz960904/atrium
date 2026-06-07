import { expect, test } from 'bun:test';
import { AcpSessionRegistry, type AcpSpec } from './registry';
import type { AcpSession } from './session';

type FakeSession = AcpSession & { disposed: boolean; resumeArg?: string };

function fakeSession(opts: { sessionId?: string; failStart?: Error } = {}): FakeSession {
  const s = {
    disposed: false,
    resumeArg: undefined as string | undefined,
    async start(_cwd: string, resume?: string) {
      s.resumeArg = resume;
      if (opts.failStart) throw opts.failStart;
      return { sessionId: opts.sessionId ?? 'sess' };
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

const spec = (providerId: string): AcpSpec => ({ providerId, command: 'x', args: [], cwd: '/ws' });

test('passes the resume id to start and returns the new session id', async () => {
  const s = fakeSession({ sessionId: 'sess-xyz' });
  const { reg } = harness([s]);
  const r = await reg.acquire('t1', spec('claude'), 'prior-123');
  expect(r.sessionId).toBe('sess-xyz');
  expect(s.resumeArg).toBe('prior-123');
});

test('reuses the same session for the same thread + provider', async () => {
  const { reg, made } = harness([fakeSession()]);
  const a = await reg.acquire('t1', spec('claude'));
  const b = await reg.acquire('t1', spec('claude'));
  expect(a.session === b.session).toBe(true);
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

test('a session that fails to start is disposed and not cached', async () => {
  const dead = fakeSession({ failStart: new Error('codex-acp not found') });
  const { reg, made } = harness([dead, fakeSession()]);

  await expect(reg.acquire('t1', spec('codex'))).rejects.toThrow('not found');
  expect(dead.disposed).toBe(true);

  // Next attempt starts a fresh session, not the cached (dead) one.
  await reg.acquire('t1', spec('codex'));
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
