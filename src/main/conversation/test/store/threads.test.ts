import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { ThreadStore } from '../../store/threads';

/**
 * The rules these pin used to live inside tRPC handlers, where the only way to
 * reach them was to send a request. They are about what the sidebar shows, so
 * getting one wrong is visible to the user and invisible to the type checker.
 */

function store(): { store: ThreadStore; db: Db } {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE threads (
    id text PRIMARY KEY NOT NULL, title text, project_id text, metadata text,
    model_provider_id text, model_id text,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL,
    last_read_at integer, archived_at integer, pinned integer DEFAULT false NOT NULL,
    session_id text)`);
  raw.run(`CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL, path text NOT NULL, name text,
    archived_at integer, pinned integer DEFAULT false NOT NULL,
    created_at integer DEFAULT 0 NOT NULL)`);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
  return { store: new ThreadStore(db), db };
}

test('unarchiving a thread revives the project it is filed under', () => {
  const { store: threads, db } = store();
  db.insert(schema.projects)
    .values({ id: 'p1', path: '/tmp/p1', name: 'p1', archivedAt: new Date(1) })
    .run();
  const id = threads.create({ projectId: 'p1' });
  threads.archive(id);

  threads.unarchive(id);

  // Left archived, the project stays hidden and the thread comes back invisible.
  expect(threads.get(id)?.archivedAt).toBeNull();
  expect(db.select().from(schema.projects).all()[0]?.archivedAt).toBeNull();
});

test('renaming does not light the unread dot', () => {
  const { store: threads } = store();
  const id = threads.create({ title: 'before' });

  threads.rename(id, 'after');

  // The dot is updatedAt running ahead of lastReadAt. A rename is done by
  // someone looking at the thread, so the two have to move together — and a
  // fresh thread has no lastReadAt at all, so failing to set it leaves null
  // rather than a stale time.
  const row = threads.get(id);
  expect(row?.title).toBe('after');
  expect(row?.lastReadAt).not.toBeNull();
  expect(row?.lastReadAt?.getTime()).toBe(row?.updatedAt?.getTime());
});

test('picking a model is not thread activity', () => {
  const { store: threads } = store();
  const id = threads.create({});
  const before = threads.get(id)?.updatedAt?.getTime();
  expect(before).toBeNumber();

  threads.setModel(id, { providerId: 'anthropic', modelId: 'claude-x' });

  // Reordering the sidebar because someone opened the model picker would be wrong.
  const row = threads.get(id);
  expect(row?.modelId).toBe('claude-x');
  expect(row?.updatedAt?.getTime()).toBe(before);
});

test('a thread that is gone reads as archived, so a task rotates off it', () => {
  const { store: threads } = store();
  const id = threads.create({});
  expect(threads.isArchived(id)).toBe(false);

  threads.archive(id);
  expect(threads.isArchived(id)).toBe(true);

  threads.remove(id);
  // A scheduled task bound to a deleted thread must start a fresh one rather
  // than fail against a row that is not there.
  expect(threads.isArchived(id)).toBe(true);
});
