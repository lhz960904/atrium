import type { Fold } from '@main/agent/context/compaction';
import type { Db } from '@main/db';
import { projects, threads } from '@main/db/schema';

import { eq } from 'drizzle-orm';
import { conversations } from './store/session';

/**
 * The join between the product's threads and the store's sessions.
 *
 * A thread row owns everything the product sorts, pins, archives and marks
 * unread by; the session owns the conversation. Reading a conversation is the
 * store's own business — what is left here either belongs to the row, or has to
 * write to both at once.
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

/**
 * The workspace root a thread runs in: its project's directory, or the
 * projectless fallback when it has no project (or the project was deleted).
 * All file tools, the sandbox, and the system prompt for a turn scope to this.
 */
export function resolveThreadWorkspace(
  db: Db,
  threadId: string,
  defaultProjectRoot: string,
): string {
  const row = db
    .select({ projectId: threads.projectId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  if (!row?.projectId) return defaultProjectRoot;
  const project = db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .get();
  return project?.path ?? defaultProjectRoot;
}

/** Replace a thread's title with the model-generated summary of its first message. */
export function setThreadTitle(db: Db, threadId: string, title: string): void {
  db.update(threads).set({ title }).where(eq(threads.id, threadId)).run();
}

/**
 * Record a fold on the thread's conversation. The folded messages stay in the
 * session — only what the model is shown gets shorter, and the reader rebuilds
 * the shorter view from this entry.
 */
export async function compactThread(db: Db, threadId: string, fold: Fold): Promise<void> {
  const conversation = await conversations().forThread(threadId);
  if (!conversation) return;
  await conversation.appendCompaction(fold);
  touchThread(db, threadId);
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
  const conversation = await conversations().forThread(threadId);
  if (!conversation) return false;
  // Any run still open would be left dangling past the new leaf; the next run
  // closes it, so there is nothing to do here but move the branch.
  if (!(await conversation.rewindTo(messageId))) return false;
  touchThread(db, threadId, { markRead: true });
  return true;
}
