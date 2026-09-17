import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import type { InteractionRequest } from '@shared/interactions';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { SessionStore, ThreadSession } from '../../store/session';
import { sessionSqlite } from '../../store/sqlite-driver';

/**
 * Against a real SQLite file, because the behaviour worth pinning here is the
 * store's own: which ids collide, when a lane is free again, and what a repair
 * does the second time it runs. A fake session would be asserting on our own
 * assumptions about pi rather than on pi.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-session-store-'));
  dirs.push(dir);
  const databasePath = join(dir, 'data.db');
  const raw = new Database(databasePath);
  raw.exec(`
    CREATE TABLE threads (
      id text PRIMARY KEY, title text, project_id text, metadata text,
      model_provider_id text, model_id text, session_id text,
      created_at integer DEFAULT 0, updated_at integer DEFAULT 0,
      last_read_at integer, archived_at integer, pinned integer DEFAULT 0);
  `);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
  const repository = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dirname(databasePath) }),
    sqlite: sessionSqlite(raw),
    databasePath,
  });
  const addThread = (id: string) => db.insert(schema.threads).values({ id }).run();
  return { db, raw, repository, store: new SessionStore(db, repository), addThread };
}

async function thread() {
  const f = fixture();
  const session = await f.repository.create({ cwd: '/tmp/work' });
  return { ...f, conversation: new ThreadSession(session) };
}

const user = (text: string): AgentMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 1,
});

const toolResult = (toolCallId: string, text: string): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content: [{ type: 'text', text }],
    isError: true,
    timestamp: 1,
  }) as AgentMessage;

const request = (id: string): InteractionRequest => ({
  id,
  runId: 'r1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
  createdAt: 1,
});

test('a lane holds one run, and finishing it hands the lane back', async () => {
  const { conversation, repository } = await thread();
  await conversation.startRun('r1');
  expect((await conversation.openRuns()).map((r) => r.id)).toEqual(['r1']);

  await expect(conversation.startRun('r2')).rejects.toThrow(/already has an open operation/);

  await conversation.finishRun('r1', 'completed');
  expect(await conversation.openRuns()).toEqual([]);
  await conversation.startRun('r2');
  expect((await conversation.openRuns()).map((r) => r.id)).toEqual(['r2']);
  await repository.close();
});

test('closing a run twice writes one record, not a collision', async () => {
  const { conversation, repository } = await thread();
  await conversation.startRun('r1');

  expect(await conversation.finishRun('r1', 'completed')).toBe(true);
  expect(await conversation.openRuns()).toEqual([]);

  // The process that opened a run and the one that repairs it never both know
  // what the other did, and the id is derived, so an unguarded second close
  // would throw rather than no-op.
  expect(await conversation.finishRun('r1', 'aborted')).toBe(false);
  const finished = (await conversation.records()).filter((r) => r.type === 'operation_finished');
  expect(finished).toHaveLength(1);
  await repository.close();
});

test('a stand-in tool result is written once however often the repair runs', async () => {
  const { conversation, repository } = await thread();
  expect(await conversation.appendInterruptedResult('r1', 'c1', toolResult('c1', 'lost'))).toBe(
    true,
  );
  expect(await conversation.appendInterruptedResult('r1', 'c1', toolResult('c1', 'lost'))).toBe(
    false,
  );

  const results = (await conversation.entries()).filter(
    (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
  );
  expect(results).toHaveLength(1);
  await repository.close();
});

test('settling a request never overwrites the answer the user gave', async () => {
  const { conversation, repository } = await thread();
  const asked = request('i1');
  await conversation.recordInteractionResolved(asked, { kind: 'denied', reason: 'no' });

  expect(
    await conversation.settleInteraction(asked, { kind: 'interrupted', reason: 'interrupted' }),
  ).toBe(false);

  const resolved = (await conversation.entries()).filter(
    (entry) => entry.type === 'custom' && entry.id === 'i1:resolved',
  );
  expect(resolved).toHaveLength(1);
  await repository.close();
});

test('a write carrying undefined survives instead of failing the turn', async () => {
  const { conversation, repository } = await thread();
  // Callers no longer reach for a normalizer of their own, so the store owes
  // them this: pi rejects `undefined` outright and one refusal fails the run.
  const message = {
    role: 'user',
    content: [{ type: 'text', text: 'hi', annotation: undefined }],
    timestamp: 1,
  } as unknown as AgentMessage;

  await conversation.appendPrompt('p1', message);
  const stored = (await conversation.entries()).flatMap((entry) =>
    entry.type === 'message' && entry.message.role === 'user' ? [entry.message.content] : [],
  );
  expect(stored).toEqual([[{ type: 'text', text: 'hi' }]]);
  await repository.close();
});

test('rewinding moves the branch back and leaves what followed in the session', async () => {
  const { conversation, repository } = await thread();
  await conversation.appendPrompt('p1', user('first'));
  await conversation.appendPrompt('p2', user('second'));

  expect(await conversation.rewindTo('missing')).toBe(false);
  expect(await conversation.rewindTo('p2')).toBe(true);

  expect((await conversation.entries()).map((entry) => entry.id)).toEqual(['p1']);
  // Nothing was deleted — the entry is still addressable off the branch.
  expect(await conversation.entry('p2')).toBeDefined();
  await repository.close();
});

test('a thread gets its conversation on first use and the same one after', async () => {
  const { store, addThread, repository } = fixture();
  addThread('t1');

  expect(await store.forThread('t1')).toBeUndefined();

  const opened = await store.openForThread('t1', '/tmp/work');
  await opened.appendPrompt('p1', user('hi'));
  const { id } = await opened.metadata();

  const reopened = await store.openForThread('t1', '/tmp/work');
  expect((await reopened.metadata()).id).toBe(id);
  expect((await reopened.entries()).map((entry) => entry.id)).toEqual(['p1']);
  await repository.close();
});

const calling = (id: string): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'bash', arguments: {} }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-x',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 2,
  }) as AgentMessage;

test('opening a conversation closes what the process before it left open', async () => {
  const { db, store, addThread, repository } = fixture();
  addThread('t1');
  const lost = await store.openForThread('t1', '/tmp/work');
  await lost.startRun('r1');
  await lost.appendTurn(calling('c1'));
  // The process dies here: the call never got its result, and nothing closed
  // the run. Until it is repaired the card reads as still running.

  const nextProcess = new SessionStore(db, repository);
  const reopened = await nextProcess.forThread('t1');

  expect(await reopened?.openRuns()).toEqual([]);
  const results = (await reopened?.entries())?.filter(
    (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
  );
  expect(results).toHaveLength(1);
  await repository.close();
});

test('a run the store is still holding is never closed underneath it', async () => {
  const { store, addThread, repository } = fixture();
  addThread('t1');
  // Opening is what repairs, and a run opens its conversation before it starts,
  // so a later read must not mistake the live run for something to clean up.
  const conversation = await store.openForThread('t1', '/tmp/work');
  await conversation.startRun('r1');

  const reader = await store.forThread('t1');

  expect((await reader?.openRuns())?.map((run) => run.id)).toEqual(['r1']);
  await repository.close();
});

test('a thread row naming a session the store lost reads as no conversation', async () => {
  const { db, store, addThread, repository } = fixture();
  addThread('t1');
  db.update(schema.threads).set({ sessionId: 'gone' }).where(eq(schema.threads.id, 't1')).run();

  expect(await store.forThread('t1')).toBeUndefined();
  await repository.close();
});
