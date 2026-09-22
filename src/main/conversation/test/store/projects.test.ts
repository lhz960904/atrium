import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { ProjectStore } from '../../store/projects';
import { openThreadStore, ThreadStore } from '../../store/threads';

/**
 * A project and its threads move together or the sidebar shows a group whose
 * halves disagree. `project_id` carries no foreign key, so nothing but these
 * rules keeps them in step — and they used to live in a tRPC handler.
 */

function store(): { projects: ProjectStore; threads: ThreadStore; db: Db } {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE threads (
    id text PRIMARY KEY NOT NULL, title text, project_id text, metadata text,
    model_provider_id text, model_id text,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL,
    last_read_at integer, archived_at integer, deleted_at integer,
    pinned integer DEFAULT false NOT NULL, session_id text)`);
  raw.run(`CREATE TABLE projects (
    id text PRIMARY KEY NOT NULL, path text NOT NULL UNIQUE, name text NOT NULL,
    pinned integer DEFAULT false NOT NULL, archived_at integer,
    created_at integer DEFAULT 0 NOT NULL)`);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
  // The project store reaches the thread store through its process singleton,
  // which is how the two halves commit in one transaction.
  openThreadStore(db);
  return { projects: new ProjectStore(db), threads: new ThreadStore(db), db };
}

const archivedAt = (db: Db, id: string) =>
  db
    .select()
    .from(schema.projects)
    .all()
    .find((p) => p.id === id)?.archivedAt ?? null;

test('adding the same folder twice is one project, and revives an archived one', () => {
  const { projects } = store();
  const first = projects.add('/work/atrium');

  expect(projects.add('/work/atrium')).toBe(first);
  expect(projects.list()).toHaveLength(1);
  // The path is the identity, so re-adding is how a user restores a project.
  projects.archive(first);
  expect(projects.list()).toEqual([]);
  expect(projects.add('/work/atrium')).toBe(first);
  expect(projects.list()).toHaveLength(1);
});

test('the project name defaults to the folder, and can be renamed', () => {
  const { projects } = store();
  const id = projects.add('/work/atrium');
  expect(projects.list()[0]).toMatchObject({ name: 'atrium' });
  projects.rename(id, 'Atrium');
  expect(projects.list()[0]).toMatchObject({ name: 'Atrium' });
});

test('archiving a project takes its active threads with it, and leaves the rest alone', () => {
  const { projects, threads, db } = store();
  const id = projects.add('/work/atrium');
  const live = threads.create({ projectId: id });
  const already = threads.create({ projectId: id });
  threads.archive(already);
  const elsewhere = threads.create();

  projects.archive(id);

  expect(archivedAt(db, id)).not.toBeNull();
  expect(threads.list().map((t) => t.id)).toEqual([elsewhere]);
  // The already-archived one keeps its own timestamp rather than being restamped.
  expect(threads.isArchived(live)).toBe(true);
  expect(threads.isArchived(already)).toBe(true);
});

test('deleting a project drops the row but only marks its threads', () => {
  const { projects, threads, db } = store();
  const id = projects.add('/work/atrium');
  const filed = threads.create({ projectId: id });
  threads.bindSession(filed, 's1');
  const elsewhere = threads.create();

  projects.remove(id);

  expect(projects.list()).toEqual([]);
  expect(db.select().from(schema.projects).all()).toEqual([]);
  expect(threads.list().map((t) => t.id)).toEqual([elsewhere]);
  // The conversation the thread names — and what it cost — has to survive.
  const row = db
    .select()
    .from(schema.threads)
    .all()
    .find((t) => t.id === filed);
  expect(row).toMatchObject({ sessionId: 's1' });
  expect(row?.deletedAt).not.toBeNull();
});
