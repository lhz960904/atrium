import type { Db } from '@main/db';
import { buildSnippet, queryTokens, type Snippet, toMatchExpr } from '@main/db/jieba';
import { createLogger } from '@main/utils/log';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';

const log = createLogger('search');

/**
 * The chat search index: what fills it, and how it is read.
 *
 * Both halves live here because they are one decision. The triggers below
 * choose what text is worth indexing and how it is tokenised; the query has to
 * match that choice to find anything, and a change to either that forgets the
 * other silently returns nothing. Keeping the writer in one module and the
 * reader in another is how a search quietly stops working.
 *
 * pi ships its own full-text search over these entries and we do not use it:
 * it tokenises with trigrams, and a two-character Chinese word — most of them —
 * never matches three-character grams.
 */

/** How many recent chats to show when the query is empty. */
const RECENT_LIMIT = 8;
/** Distinct threads returned for a query. */
const RESULT_LIMIT = 30;
/** Raw FTS rows to score before aggregating to threads (one thread can own many). */
const SCAN_LIMIT = 200;
/** bm25 is lower-is-better; nudge title hits ahead of body hits of the same thread. */
const TITLE_BOOST = 2;

export type SearchScope = 'active' | 'archived';

export type SearchHit = {
  threadId: string;
  title: string | null;
  updatedAt: number;
  /** When the thread was archived; null for active threads. */
  archivedAt: number | null;
  /** Where the match landed; null for the empty-query recent list. */
  matchedIn: 'title' | 'message' | null;
  /** The message a body match came from — for deep-linking into the thread. */
  messageId: string | null;
  snippet: Snippet | null;
};

type FtsRow = {
  threadId: string;
  messageId: string | null;
  kind: 'title' | 'message';
  raw: string;
  title: string | null;
  updatedAt: number;
  archivedAt: number | null;
  score: number;
};

type RecentRow = {
  threadId: string;
  title: string | null;
  updatedAt: number;
  archivedAt: number | null;
};

/**
 * Keep the chat search index fed from the session store.
 *
 * The index itself, and the triggers that keep thread titles in it, belong to
 * our own schema. Message text now lives in the store's entries, so the triggers
 * that index it are attached here instead of in a migration: the entries table
 * is created by the store's own migrations, which run after ours.
 *
 * They stay triggers rather than a call from the writer because that is what
 * makes the index a property of the data instead of a thing every writer has to
 * remember. `jieba_cut()` is registered on this connection, which is the same
 * connection the store writes through — the reason it has to be shared at all.
 */
export function attachChatSearch(db: Database.Database): void {
  // Only message entries carry conversation text, and only their text content:
  // a tool call's arguments and a reasoning block are not what anyone searches
  // for. A thread is found through the session it owns.
  const indexed = `
    SELECT jieba_cut(raw), raw, 'message', thread_id, new.id, new.timestamp
    FROM (
      SELECT
        (SELECT id FROM threads WHERE session_id = new.session_id) AS thread_id,
        (
          SELECT group_concat(json_extract(je.value, '$.text'), char(10))
          FROM json_each(new.payload, '$.message.content') je
          WHERE json_extract(je.value, '$.type') = 'text'
        ) AS raw
    )
    WHERE thread_id IS NOT NULL AND raw IS NOT NULL AND raw <> ''`;

  // A user message may carry its content as a bare string rather than a list;
  // json_each would reject that outright, so the guard is on the type.
  const isIndexable = `new.type = 'message' AND json_type(new.payload, '$.message.content') = 'array'`;

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_ai
    AFTER INSERT ON entries WHEN ${isIndexable}
    BEGIN
      INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
      ${indexed};
    END;

    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_au
    AFTER UPDATE OF payload ON entries WHEN ${isIndexable}
    BEGIN
      DELETE FROM chat_fts WHERE message_id = old.id;
      INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
      ${indexed};
    END;

    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_ad
    AFTER DELETE ON entries
    BEGIN
      DELETE FROM chat_fts WHERE message_id = old.id;
    END;
  `);
  log.info('chat search index attached to the session store');
}

/** The scope's threads, for a search box that has not been typed in yet. */
function recentChats(db: Db, scope: SearchScope): SearchHit[] {
  const rows = (
    scope === 'archived'
      ? db.all(
          sql`SELECT id AS "threadId", title, updated_at AS "updatedAt", archived_at AS "archivedAt"
              FROM threads WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`,
        )
      : db.all(
          sql`SELECT id AS "threadId", title, updated_at AS "updatedAt", archived_at AS "archivedAt"
              FROM threads WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT}`,
        )
  ) as RecentRow[];
  return rows.map((row) => ({
    threadId: row.threadId,
    title: row.title,
    updatedAt: Number(row.updatedAt),
    archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
    matchedIn: null,
    messageId: null,
    snippet: null,
  }));
}

/**
 * Search chats by title and message body, within one archive scope.
 *
 * `active` (the ⌘K palette) hides archived chats; `archived` (the settings
 * page) shows only them. An empty query returns the scope's threads — the
 * recent few for active, all for archived — so each surface opens to something
 * useful rather than to nothing.
 */
export function searchChats(
  db: Db,
  query: string,
  scope: SearchScope = 'active',
): { query: string; hits: SearchHit[] } {
  const q = query.trim();
  if (!q) return { query: '', hits: recentChats(db, scope) };

  const tokens = queryTokens(q);
  const expr = toMatchExpr(tokens);
  if (!expr) return { query: q, hits: [] };

  const archivedCond =
    scope === 'archived' ? sql`t.archived_at IS NOT NULL` : sql`t.archived_at IS NULL`;
  const rows = db.all(
    sql`SELECT chat_fts.thread_id AS "threadId", chat_fts.message_id AS "messageId",
               chat_fts.kind AS kind, chat_fts.text_raw AS raw,
               t.title AS title, t.updated_at AS "updatedAt", t.archived_at AS "archivedAt",
               bm25(chat_fts) AS score
        FROM chat_fts
        JOIN threads t ON t.id = chat_fts.thread_id
        WHERE chat_fts MATCH ${expr} AND ${archivedCond}
        ORDER BY rank
        LIMIT ${SCAN_LIMIT}`,
  ) as FtsRow[];

  // Collapse to one hit per thread, keeping its best-scoring row.
  const best = new Map<string, { row: FtsRow; effScore: number }>();
  for (const row of rows) {
    const effScore = row.score - (row.kind === 'title' ? TITLE_BOOST : 0);
    const current = best.get(row.threadId);
    if (!current || effScore < current.effScore) best.set(row.threadId, { row, effScore });
  }

  const hits = [...best.values()]
    .sort((a, b) => a.effScore - b.effScore)
    .slice(0, RESULT_LIMIT)
    .map(
      ({ row }): SearchHit => ({
        threadId: row.threadId,
        title: row.title,
        updatedAt: Number(row.updatedAt),
        archivedAt: row.archivedAt == null ? null : Number(row.archivedAt),
        matchedIn: row.kind,
        messageId: row.kind === 'message' ? row.messageId : null,
        snippet: buildSnippet(row.raw, tokens),
      }),
    );

  return { query: q, hits };
}
