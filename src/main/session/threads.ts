import type { Session } from '@earendil-works/pi-agent-core';
import type { SqliteSessionMetadata } from '@earendil-works/pi-session-backend-sqlite-node';
import type { AtriumUIMessage } from '@shared/chat';
import type { ToolCall, ToolResultMessage } from '@shared/protocol';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { threads } from '../db/schema';
import { openToolCalls, projectMessages } from './project';
import { sessionStore } from './repo';

/**
 * The join between the product's threads and the store's sessions.
 *
 * A thread row owns everything the product sorts, pins, archives and marks
 * unread by; the session owns the conversation. They are addressed by id from
 * here and nowhere else, which is what keeps either free to change shape.
 */

/**
 * Move a thread to the top of the sidebar. `markRead` also clears its unread
 * dot, which is right whenever the write was the user's own doing — their own
 * message, or a turn they stopped while watching it.
 */
export function touchThread(db: Db, threadId: string, opts: { markRead?: boolean } = {}): void {
  const now = new Date();
  db.update(threads)
    .set(opts.markRead ? { updatedAt: now, lastReadAt: now } : { updatedAt: now })
    .where(eq(threads.id, threadId))
    .run();
}

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
/**
 * A thread's conversation in the shape the renderer consumes. A thread that has
 * never run has no session yet, which reads as an empty conversation.
 */
export async function threadMessages(db: Db, threadId: string): Promise<AtriumUIMessage[]> {
  const session = await findThreadSession(db, threadId);
  if (!session) return [];
  const [entries, records] = await Promise.all([
    session.findEntriesOnBranch({ order: 'oldestFirst' }),
    session.findRecords({ order: 'oldestFirst' }),
  ]);
  return projectMessages(entries, records);
}

/**
 * The calls a thread's conversation is still waiting on the user for, by id.
 * The session is the authority: a client working from a stale view can only
 * ask about fewer calls than it thinks, never more.
 */
export async function openThreadCalls(db: Db, threadId: string): Promise<Map<string, ToolCall>> {
  const session = await findThreadSession(db, threadId);
  if (!session) return new Map();
  const entries = await session.findEntriesOnBranch({ order: 'oldestFirst' });
  return new Map(openToolCalls(entries).map((call) => [call.id, call]));
}

/**
 * Close calls with the results the user's decisions produced, without running
 * the model — a cancelled clarification, where the user has taken the turn back
 * and will send again themselves. The call still has to be closed, or the next
 * request's history carries an unpaired call.
 */
export async function settleThreadCalls(
  db: Db,
  threadId: string,
  results: ToolResultMessage[],
): Promise<void> {
  if (results.length === 0) return;
  const session = await findThreadSession(db, threadId);
  if (!session) return;
  for (const result of results) await session.appendMessage(result as never);
  touchThread(db, threadId);
}

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
