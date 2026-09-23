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
 * A deleted thread keeps its rows in the index — the conversation is still
 * there — so both queries below exclude it themselves. Nothing prunes the
 * index on delete, which is what makes the mark reversible if it ever needs
 * to be.
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
              FROM threads WHERE archived_at IS NOT NULL AND deleted_at IS NULL
              ORDER BY archived_at DESC`,
        )
      : db.all(
          sql`SELECT id AS "threadId", title, updated_at AS "updatedAt", archived_at AS "archivedAt"
              FROM threads WHERE archived_at IS NULL AND deleted_at IS NULL
              ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT}`,
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
        WHERE chat_fts MATCH ${expr} AND ${archivedCond} AND t.deleted_at IS NULL
        ORDER BY rank
        LIMIT ${SCAN_LIMIT}`,
  ) as FtsRow[];

  // Collapse to one hit per thread, then order the threads. A title match wins
  // over a body match either way: the title is what the conversation is called,
  // so matching it says more than matching a line inside it. bm25 only decides
  // between two matches of the same kind.
  //
  // This was a constant subtracted from the score, which read like a weight but
  // could never behave as one: bm25 here lands around 1e-6, so any offset big
  // enough to matter made the rule absolute anyway.
  const best = new Map<string, FtsRow>();
  for (const row of rows) {
    const current = best.get(row.threadId);
    if (!current || better(row, current)) best.set(row.threadId, row);
  }

  const hits = [...best.values()]
    .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
    .slice(0, RESULT_LIMIT)
    .map(
      (row): SearchHit => ({
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

/**
 * Whether `row` is the stronger match: a title beats a body, then lower bm25.
 *
 * The query already returns rows best-first, so the score half is what keeps
 * this rule from depending on that — the kind half is not implied by it, since
 * a title row can arrive after a body row that scored better.
 */
function better(row: FtsRow, than: FtsRow): boolean {
  if (row.kind !== than.kind) return row.kind === 'title';
  return row.score < than.score;
}
