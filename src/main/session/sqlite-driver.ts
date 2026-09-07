import type {
  SqliteDatabase,
  SqliteDatabaseFactory,
  SqliteStatement,
} from '@earendil-works/pi-session-backend-sqlite-node';

/**
 * The part of a SQLite connection the session store actually uses.
 *
 * Declared structurally rather than as better-sqlite3's own type so the adapter
 * can be exercised off Electron: better-sqlite3 is a native module bun can't
 * load, while `bun:sqlite` — modelled on the same API — satisfies this shape.
 * The production call site still passes a real better-sqlite3 connection, which
 * is where the compiler checks the two agree.
 */
export type SqliteConnection = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): Iterable<unknown>;
  };
  transaction<T>(fn: () => T): () => T;
};

/**
 * The session backend's SQLite capability, served by the connection the app
 * already holds.
 *
 * Sharing the one connection is not an optimization. The chat search index is
 * kept by triggers that call `jieba_cut()`, a function registered on this
 * handle and nowhere else, so a second connection to the same file would fail
 * every write the session makes.
 */
export function sessionSqlite(db: SqliteConnection): SqliteDatabaseFactory {
  const statement = (stmt: ReturnType<SqliteConnection['prepare']>): SqliteStatement => ({
    run: (...params) => {
      const result = stmt.run(...params);
      return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get: <TRow extends object>(...params: unknown[]) => stmt.get(...params) as TRow | undefined,
    all: <TRow extends object>(...params: unknown[]) => stmt.all(...params) as TRow[],
    iterate: <TRow extends object>(...params: unknown[]) =>
      stmt.iterate(...params) as Iterable<TRow>,
  });

  const database: SqliteDatabase = {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => statement(db.prepare(sql)),
    // better-sqlite3 hands back a callable; the backend expects the call itself.
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    // The connection outlives any repository — the app opened it and the app closes it.
    close: () => {},
  };

  return { open: async () => database };
}
