import { randomUUID } from 'node:crypto';
import type { AgentMessage, Session } from '@earendil-works/pi-agent-core';
import type { SqliteSessionMetadata } from '@earendil-works/pi-session-backend-sqlite-node';
import type { AtriumUIMessage } from '@shared/chat';
import type { Message, ToolCall, ToolResultMessage } from '@shared/protocol';
import { eq } from 'drizzle-orm';
import type { Fold } from '../agent/pi/compaction';
import { asStored } from '../agent/pi/vocabulary';
import type { Db } from '../db';
import { threads } from '../db/schema';
import { openToolCalls, projectHistory, projectMessages } from './project';
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

/**
 * Record a fold on the thread's conversation. The folded messages stay in the
 * session — only what the model is shown gets shorter, and the reader rebuilds
 * the shorter view from this entry.
 */
export async function compactThread(db: Db, threadId: string, fold: Fold): Promise<void> {
  const session = await findThreadSession(db, threadId);
  if (!session) return;
  await session.appendEntry(
    {
      id: randomUUID(),
      type: 'compaction',
      summary: fold.summary,
      retainedTail: fold.retainedTail as unknown as AgentMessage[],
      tokensBefore: fold.tokensBefore,
    },
    'main',
  );
  touchThread(db, threadId);
}

/** A thread's transcript as the engine runs it, folded at its latest compaction. */
export async function threadHistory(db: Db, threadId: string): Promise<Message[]> {
  const session = await findThreadSession(db, threadId);
  if (!session) return [];
  return asStored(projectHistory(await session.findEntriesOnBranch({ order: 'oldestFirst' })));
}

/**
 * Take the conversation back to just before one message, so the next turn
 * continues from there — what editing an earlier message and re-running needs.
 *
 * Nothing is deleted. The branch is moved back and the messages after it stay in
 * the session, off to one side, which is both cheaper than a delete and the
 * reason a re-run can never half-truncate a thread.
 */
export async function rewindThread(db: Db, threadId: string, messageId: string): Promise<boolean> {
  const session = await findThreadSession(db, threadId);
  if (!session) return false;
  const entry = await session.getEntry(messageId);
  if (!entry) return false;
  // Any run still open would be left dangling past the new leaf; the next run
  // closes it, so there is nothing to do here but move the branch.
  await session.moveLane('main', entry.parentId);
  touchThread(db, threadId, { markRead: true });
  return true;
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
