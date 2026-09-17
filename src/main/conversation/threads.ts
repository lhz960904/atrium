import type { Entry, AgentMessage as Message } from '@earendil-works/pi-agent-core';
import type { Fold } from '@main/agent/context/compaction';
import { sealDanglingToolCalls } from '@main/conversation/history';
import type { Db } from '@main/db';
import { projects, threads } from '@main/db/schema';
import type { AtriumUIMessage } from '@shared/chat';

import { eq } from 'drizzle-orm';
import { projectHistory, projectMessages } from './project';
import { interruptionTextFromEntries } from './recovery';
import { conversations, type ThreadSession } from './store/session';

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

/** The conversation a thread's messages live in, or undefined if it has none yet. */
export function findThreadSession(threadId: string): Promise<ThreadSession | undefined> {
  return conversations().forThread(threadId);
}

/**
 * A thread's conversation in the shape the renderer consumes. A thread that has
 * never run has no session yet, which reads as an empty conversation.
 */
export async function threadMessages(threadId: string): Promise<AtriumUIMessage[]> {
  const conversation = await findThreadSession(threadId);
  if (!conversation) return [];
  const [entries, records] = await Promise.all([conversation.entries(), conversation.records()]);
  return projectMessages(entries, records);
}

/**
 * Record a fold on the thread's conversation. The folded messages stay in the
 * session — only what the model is shown gets shorter, and the reader rebuilds
 * the shorter view from this entry.
 */
export async function compactThread(db: Db, threadId: string, fold: Fold): Promise<void> {
  const conversation = await findThreadSession(threadId);
  if (!conversation) return;
  await conversation.appendCompaction(fold);
  touchThread(db, threadId);
}

/** A thread's transcript as the engine runs it, folded at its latest compaction. */
export async function threadHistory(threadId: string): Promise<Message[]> {
  const conversation = await findThreadSession(threadId);
  if (!conversation) return [];
  return runnableHistory(await conversation.entries());
}

/**
 * The transcript with every unanswered tool call closed.
 *
 * A run cut off mid-tool — a crash, a kill — leaves a call whose result never
 * arrived, and a provider rejects any later request whose history holds one, so
 * one interrupted turn would wedge the thread for good.
 */
export function runnableHistory(entries: Entry[]): Message[] {
  return sealDanglingToolCalls(projectHistory(entries), (call) =>
    interruptionTextFromEntries(entries, call),
  );
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
  const conversation = await findThreadSession(threadId);
  if (!conversation) return false;
  // Any run still open would be left dangling past the new leaf; the next run
  // closes it, so there is nothing to do here but move the branch.
  if (!(await conversation.rewindTo(messageId))) return false;
  touchThread(db, threadId, { markRead: true });
  return true;
}

/** Drop a thread's conversation. The thread row is the caller's to remove. */
export function deleteThreadSession(threadId: string): Promise<void> {
  return conversations().deleteForThread(threadId);
}

/** A thread's conversation, created on first use. */
export function openThreadSession(threadId: string, workspaceRoot: string): Promise<ThreadSession> {
  return conversations().openForThread(threadId, workspaceRoot);
}
