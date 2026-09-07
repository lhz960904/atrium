import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import { sessionSqlite } from './sqlite-driver';

/**
 * The substrate against a real SQLite file: the backend's migrations, its
 * schema and its writes all have to work through the driver we hand it, which
 * is the app's own connection rather than the one the package would open.
 */
const env = {
  absolutePath: async (path: string) => ({ ok: true as const, value: path }),
  exists: async () => ({ ok: true as const, value: true }),
  createDir: async () => ({ ok: true as const, value: undefined }),
};

function store() {
  // bun:sqlite stands in for the app's better-sqlite3 connection; the driver is
  // typed on the shape both satisfy.
  const db = new Database(':memory:');
  const repo = new SqliteSessionRepository({
    env,
    sqlite: sessionSqlite(db),
    databasePath: ':memory:',
  });
  return { db, repo };
}

const user = (text: string): AgentMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
});

test('the backend migrates itself onto the connection we hand it', async () => {
  const { db, repo } = store();
  await repo.create({ cwd: '/tmp/work' });

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  expect(tables).toContain('entries');
  expect(tables).toContain('records');
  expect(tables).toContain('writer_leases');
  await repo.close();
});

test('messages append and read back on the session branch', async () => {
  const { repo } = store();
  const created = await repo.create({ cwd: '/tmp/work' });
  await created.appendMessage(user('first'));
  await created.appendMessage(user('second'));

  const entries = await created.findEntriesOnBranch({ order: 'oldestFirst' });
  const texts = entries.flatMap((entry) =>
    entry.type === 'message' && entry.message.role === 'user' ? [entry.message.content] : [],
  );
  expect(texts).toEqual([[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]]);
  await repo.close();
});

test('reopening the same session hands back the live writer, not a second one', async () => {
  const { repo } = store();
  const created = await repo.create({ cwd: '/tmp/work' });
  const metadata = await created.getMetadata();

  const reopened = await repo.open(metadata);
  await reopened.appendMessage(user('through the second handle'));
  expect((await created.findEntriesOnBranch()).length).toBe(1);
  await repo.close();
});

test('a session survives the repository being closed and reopened', async () => {
  const { db, repo } = store();
  const created = await repo.create({ cwd: '/tmp/work' });
  const metadata = await created.getMetadata();
  await created.appendMessage(user('before close'));
  // Releases the writer lease; our driver leaves the connection itself alone.
  await repo.close();

  const reopened = new SqliteSessionRepository({
    env,
    sqlite: sessionSqlite(db),
    databasePath: ':memory:',
  });
  const session = await reopened.open(metadata);
  expect((await session.findEntriesOnBranch()).length).toBe(1);
  await reopened.close();
});

test('the store lists what it created', async () => {
  const { repo } = store();
  const created = await repo.create({ cwd: '/tmp/work' });
  const metadata = await created.getMetadata();

  const listed = await repo.list();
  expect(listed.map((s) => s.id)).toEqual([metadata.id]);
  await repo.close();
});
