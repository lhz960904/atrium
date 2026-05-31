import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import type { RunContext, RunResultInfo } from '../types';
import { persistenceMiddleware } from './persistence';

test('afterRun persists the assistant message with the run thread + db', async () => {
  const calls: Array<{ db: Db; threadId: string; message: RunResultInfo['message'] }> = [];
  const mw = persistenceMiddleware((db, threadId, message) => {
    calls.push({ db, threadId, message });
  });

  const db = { tag: 'db' } as unknown as Db;
  const ctx = { threadId: 't1', db } as unknown as RunContext;
  const message = { id: 'm1', role: 'assistant', parts: [] } as RunResultInfo['message'];

  await mw.afterRun?.(ctx, { message });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ db, threadId: 't1', message });
});
