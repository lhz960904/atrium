import type { Session } from '@earendil-works/pi-agent-core';
import type { SqliteSessionMetadata } from '@earendil-works/pi-session-backend-sqlite-node';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { threads } from '../db/schema';
import { sessionStore } from './repo';

/**
 * The join between the product's threads and the store's sessions.
 *
 * A thread row owns everything the product sorts, pins, archives and marks
 * unread by; the session owns the conversation. They are addressed by id from
 * here and nowhere else, which is what keeps either free to change shape.
 */

/** The session a thread's conversation lives in, or undefined if it has none yet. */
export async function findThreadSession(
  db: Db,
  threadId: string,
): Promise<Session<SqliteSessionMetadata> | undefined> {
  const row = db
    .select({ sessionId: threads.sessionId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  if (!row?.sessionId) return undefined;
  const sessions = await sessionStore().list();
  const metadata = sessions.find((session) => session.id === row.sessionId);
  // The row can outlive the session it names — a store rebuilt from scratch,
  // say. Treating that as "no conversation yet" keeps the thread openable.
  return metadata ? sessionStore().open(metadata) : undefined;
}

/**
 * The thread's session, created on first use.
 *
 * Creating it with the first turn rather than with the thread keeps a thread
 * nobody wrote to free, and means the workspace it records is the one the turn
 * actually ran in.
 */
export async function openThreadSession(
  db: Db,
  threadId: string,
  workspaceRoot: string,
): Promise<Session<SqliteSessionMetadata>> {
  const existing = await findThreadSession(db, threadId);
  if (existing) return existing;

  const session = await sessionStore().create({ cwd: workspaceRoot });
  const { id } = await session.getMetadata();
  db.update(threads).set({ sessionId: id }).where(eq(threads.id, threadId)).run();
  return session;
}
