import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { ok } from '@earendil-works/pi-agent-core';
import {
  SqliteSessionRepository,
  type SqliteSessionRepositoryEnv,
} from '@earendil-works/pi-session-backend-sqlite-node';
import type Database from 'better-sqlite3';
import { createLogger } from '../log';
import { sessionSqlite } from './sqlite-driver';

const log = createLogger('session');

/**
 * The three filesystem calls the repository makes. It only ever asks about the
 * database file itself — where it is, whether it exists, and that its directory
 * is there — so this is the whole surface, not a stub of a larger one.
 */
const nodeEnv: SqliteSessionRepositoryEnv = {
  absolutePath: async (path) => ok(isAbsolute(path) ? path : resolve(path)),
  exists: async (path) =>
    ok(
      await stat(path).then(
        () => true,
        () => false,
      ),
    ),
  createDir: async (path, options) => {
    await mkdir(path, { recursive: options?.recursive ?? false });
    return ok(undefined);
  },
};

let repository: SqliteSessionRepository | undefined;
let ready: Promise<void> | undefined;

/**
 * The session store: one repository over the app's own database connection.
 *
 * A thread's conversation lives here as pi entries and records, while the
 * thread row keeps what the product needs to sort, pin, archive and mark it
 * unread. The two halves address each other by id and are never joined in one
 * query, which is what lets the session store keep its own shape.
 */
export function openSessionStore(db: Database.Database, databasePath: string): void {
  if (repository) return;
  // The default 30s lease is deliberate. Opening a session takes a writer lease
  // that only a later open past its expiry may steal, so the TTL is also how
  // long a thread stays locked after a crash — a longer one would trade a
  // problem we don't have (two processes) for one we would.
  repository = new SqliteSessionRepository({
    env: nodeEnv,
    sqlite: sessionSqlite(db),
    databasePath,
  });
  // Touch the store now rather than on the first message. Opening is what runs
  // its migrations, and those read a file shipped beside the bundle — a boot
  // that can't find it should say so here, not halfway through a turn.
  ready = repository
    .list()
    .then((sessions) => {
      log.info(`session store open on ${databasePath} (${sessions.length} session(s))`);
    })
    .catch((err) => {
      log.error(`session store failed to open on ${databasePath}`, err);
      throw err;
    });
  void ready.catch(() => {});
}

export function sessionStore(): SqliteSessionRepository {
  if (!repository) throw new Error('session store not initialized — call openSessionStore() first');
  return repository;
}

/** Release every open session's writer lease. The connection is not ours to close. */
export async function closeSessionStore(): Promise<void> {
  await repository?.close();
  repository = undefined;
  ready = undefined;
}
