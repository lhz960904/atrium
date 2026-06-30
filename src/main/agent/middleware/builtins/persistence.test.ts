import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import type { RunContext, RunResultInfo } from '../types';
import { persistenceMiddleware } from './persistence';

type Captured = {
  db: Db;
  threadId: string;
  message: RunResultInfo['message'];
  opts?: { markRead?: boolean };
};

function capture(): { calls: Captured[]; mw: ReturnType<typeof persistenceMiddleware> } {
  const calls: Captured[] = [];
  const mw = persistenceMiddleware((db, threadId, message, opts) => {
    calls.push({ db, threadId, message, opts });
  });
  return { calls, mw };
}

const db = { tag: 'db' } as unknown as Db;
const ctx = { threadId: 't1', db } as unknown as RunContext;
const message = { id: 'm1', role: 'assistant', parts: [] } as RunResultInfo['message'];

test('afterRun persists the assistant message with the run thread + db', async () => {
  const { calls, mw } = capture();

  await mw.afterRun?.(ctx, { message });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ db, threadId: 't1', message, opts: { markRead: undefined } });
});

test('afterRun marks a user-aborted turn as read so it skips the unread dot', async () => {
  const { calls, mw } = capture();

  await mw.afterRun?.(ctx, { message, aborted: true });

  expect(calls[0]?.opts).toEqual({ markRead: true });
});
