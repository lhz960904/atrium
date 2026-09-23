import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import { segment } from '@main/db/jieba';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { searchChats } from '../search';

/**
 * The query side of chat search, against a real FTS5 index.
 *
 * bun:sqlite has no user-defined SQL functions, so the triggers — which call
 * `jieba_cut()` — cannot run here; the fixture indexes through `segment()`
 * instead, which is the same function the SQL one wraps. What that leaves
 * covered is exactly what this module decides: what matches, which hit wins
 * when one thread matches twice, and what each scope may see.
 */

function fixture() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE threads (
      id text PRIMARY KEY, title text, project_id text, metadata text,
      model_provider_id text, model_id text, session_id text,
      created_at integer DEFAULT 0, updated_at integer DEFAULT 0,
      last_read_at integer, archived_at integer, deleted_at integer, pinned integer DEFAULT 0);
    CREATE VIRTUAL TABLE chat_fts USING fts5(
      text_indexed, text_raw UNINDEXED, kind UNINDEXED, thread_id UNINDEXED,
      message_id UNINDEXED, created_at UNINDEXED, tokenize = 'unicode61');
  `);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;

  const index = (
    kind: 'title' | 'message',
    threadId: string,
    messageId: string | null,
    text: string,
  ) =>
    raw
      .query(
        `INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(segment(text), text, kind, threadId, messageId);

  const thread = (
    id: string,
    {
      title,
      updatedAt = 0,
      archivedAt = null,
      deletedAt = null,
    }: {
      title?: string;
      updatedAt?: number;
      archivedAt?: number | null;
      deletedAt?: number | null;
    } = {},
  ) => {
    raw
      .query(
        `INSERT INTO threads(id, title, updated_at, archived_at, deleted_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title ?? null, updatedAt, archivedAt, deletedAt);
    if (title) index('title', id, null, title);
  };

  const message = (threadId: string, messageId: string, text: string) =>
    index('message', threadId, messageId, text);

  return { db, thread, message };
}

test('a two-character Chinese word matches, and the hit carries its message and snippet', () => {
  const f = fixture();
  f.thread('t1');
  f.message('t1', 'm1', '我们把索引写进了会话存储里');

  const { hits } = searchChats(f.db, '索引');

  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ threadId: 't1', matchedIn: 'message', messageId: 'm1' });
  // The highlight is built against the original text, not the segmented copy.
  expect(hits[0]?.snippet?.text).toContain('索引');
});

test('a thread matched in both title and body comes back once, as a title hit', () => {
  const f = fixture();
  // A long title and a one-word message, so bm25 on its own prefers the
  // message: the title wins because a title match outranks a body match, not
  // because of anything the scores say.
  f.thread('t1', {
    title: 'a long chat title that goes on about the search index and other things',
  });
  f.message('t1', 'm1', 'index');

  const { hits } = searchChats(f.db, 'index');

  expect(hits).toHaveLength(1);
  // The row the user sees names the thread rather than a line buried inside it.
  expect(hits[0]).toMatchObject({ matchedIn: 'title', messageId: null });
});

test('a thread matched by title outranks one matched only in its body', () => {
  const f = fixture();
  // The body match is the better one by bm25 — a single word, nothing else —
  // and still sorts second.
  f.thread('titled', { title: 'a long chat title that mentions the index among other things' });
  f.thread('bodied');
  f.message('bodied', 'm1', 'index');

  const { hits } = searchChats(f.db, 'index');

  expect(hits.map((hit) => hit.threadId)).toEqual(['titled', 'bodied']);
  expect(hits.map((hit) => hit.matchedIn)).toEqual(['title', 'message']);
});

test('two body matches are ordered by bm25, the shorter message first', () => {
  const f = fixture();
  f.thread('short');
  f.message('short', 'm1', 'index');
  f.thread('long');
  f.message('long', 'm2', 'the index is one word among a great many other words in this message');

  expect(searchChats(f.db, 'index').hits.map((hit) => hit.threadId)).toEqual(['short', 'long']);
});

test('every token has to match, so an unrelated second word finds nothing', () => {
  const f = fixture();
  f.thread('t1');
  f.message('t1', 'm1', 'the index is fed by triggers');

  expect(searchChats(f.db, 'index triggers').hits).toHaveLength(1);
  expect(searchChats(f.db, 'index bananas').hits).toHaveLength(0);
});

test('each scope sees only its own threads', () => {
  const f = fixture();
  f.thread('live');
  f.message('live', 'm1', 'shared keyword');
  f.thread('gone', { archivedAt: 5 });
  f.message('gone', 'm2', 'shared keyword');

  expect(searchChats(f.db, 'keyword', 'active').hits.map((h) => h.threadId)).toEqual(['live']);
  expect(searchChats(f.db, 'keyword', 'archived').hits.map((h) => h.threadId)).toEqual(['gone']);
});

test('an empty query lists the scope: the recent few active, all archived', () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) f.thread(`live-${i}`, { updatedAt: i });
  f.thread('gone-1', { archivedAt: 1 });
  f.thread('gone-2', { archivedAt: 2 });

  const active = searchChats(f.db, '   ', 'active');
  expect(active.query).toBe('');
  expect(active.hits).toHaveLength(8);
  // Most recently updated first, and nothing claims to have matched anything.
  expect(active.hits[0]).toMatchObject({ threadId: 'live-11', matchedIn: null, snippet: null });

  const archived = searchChats(f.db, '', 'archived');
  expect(archived.hits.map((h) => h.threadId)).toEqual(['gone-2', 'gone-1']);
});

test('a deleted thread is unfindable, though its text is still indexed', () => {
  const f = fixture();
  f.thread('live', { title: 'quarterly plan' });
  f.message('live', 'm1', 'the quarterly plan');
  f.thread('gone', { title: 'quarterly plan', deletedAt: 9 });
  f.message('gone', 'm2', 'the quarterly plan');
  f.thread('archived-and-gone', { archivedAt: 5, deletedAt: 9 });
  f.message('archived-and-gone', 'm3', 'the quarterly plan');

  // Deleting never prunes the index — the conversation is still there — so the
  // queries have to exclude it themselves, in both scopes and in the empty-query
  // listing each scope opens with.
  expect(searchChats(f.db, 'quarterly', 'active').hits.map((h) => h.threadId)).toEqual(['live']);
  expect(searchChats(f.db, 'quarterly', 'archived').hits).toEqual([]);
  expect(searchChats(f.db, '', 'active').hits.map((h) => h.threadId)).toEqual(['live']);
  expect(searchChats(f.db, '', 'archived').hits).toEqual([]);
});
