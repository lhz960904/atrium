import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { buildSnippet, queryTokens, type Snippet, toMatchExpr } from '../../db/jieba';
import { publicProcedure, router } from '../trpc';

/** How many recent chats to show when the query is empty. */
const RECENT_LIMIT = 8;
/** Distinct threads returned for a query. */
const RESULT_LIMIT = 30;
/** Raw FTS rows to score before aggregating to threads (one thread can own many). */
const SCAN_LIMIT = 200;
/** bm25 is lower-is-better; nudge title hits ahead of body hits of the same thread. */
const TITLE_BOOST = 2;

export type SearchHit = {
  threadId: string;
  title: string | null;
  updatedAt: number;
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
  score: number;
};

type RecentRow = { threadId: string; title: string | null; updatedAt: number };

export const searchRouter = router({
  /**
   * Search chats by title + message body. Empty query returns recent threads
   * (so the palette opens to something useful); a query returns BM25-ranked
   * threads with a highlighted snippet of the best match in each.
   */
  chats: publicProcedure.input(z.object({ query: z.string() })).query(({ ctx, input }) => {
    const q = input.query.trim();

    if (!q) {
      const rows = ctx.db.all(
        sql`SELECT id AS "threadId", title, updated_at AS "updatedAt"
            FROM threads ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT}`,
      ) as RecentRow[];
      return {
        query: '',
        hits: rows.map(
          (r): SearchHit => ({
            threadId: r.threadId,
            title: r.title,
            updatedAt: Number(r.updatedAt),
            matchedIn: null,
            messageId: null,
            snippet: null,
          }),
        ),
      };
    }

    const tokens = queryTokens(q);
    const expr = toMatchExpr(tokens);
    if (!expr) return { query: q, hits: [] };

    const rows = ctx.db.all(
      sql`SELECT chat_fts.thread_id AS "threadId", chat_fts.message_id AS "messageId",
                 chat_fts.kind AS kind, chat_fts.text_raw AS raw,
                 t.title AS title, t.updated_at AS "updatedAt", bm25(chat_fts) AS score
          FROM chat_fts
          JOIN threads t ON t.id = chat_fts.thread_id
          WHERE chat_fts MATCH ${expr}
          ORDER BY rank
          LIMIT ${SCAN_LIMIT}`,
    ) as FtsRow[];

    // Collapse to one hit per thread, keeping its best-scoring row.
    const best = new Map<string, { row: FtsRow; effScore: number }>();
    for (const row of rows) {
      const effScore = row.score - (row.kind === 'title' ? TITLE_BOOST : 0);
      const cur = best.get(row.threadId);
      if (!cur || effScore < cur.effScore) best.set(row.threadId, { row, effScore });
    }

    const hits = [...best.values()]
      .sort((a, b) => a.effScore - b.effScore)
      .slice(0, RESULT_LIMIT)
      .map(
        ({ row }): SearchHit => ({
          threadId: row.threadId,
          title: row.title,
          updatedAt: Number(row.updatedAt),
          matchedIn: row.kind,
          messageId: row.kind === 'message' ? row.messageId : null,
          snippet: buildSnippet(row.raw, tokens),
        }),
      );

    return { query: q, hits };
  }),
});
