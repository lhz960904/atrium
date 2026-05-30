import type { UIMessage } from 'ai';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { messages, threads } from '../db/schema';

/** Load a thread's messages from the DB as UIMessages, oldest first. */
export function loadThreadMessages(db: Db, threadId: string): UIMessage[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt))
    .all()
    .map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts as UIMessage['parts'],
      metadata: m.metadata ?? undefined,
    }));
}

/**
 * Persist one UIMessage into a thread, storing parts verbatim (the canonical
 * shape since Step 5). Idempotent on message id so re-sends / retries don't
 * duplicate. Bumps the thread's updatedAt so the sidebar re-sorts.
 */
export function persistMessage(db: Db, threadId: string, msg: UIMessage): void {
  db.insert(messages)
    .values({
      id: msg.id,
      threadId,
      role: msg.role,
      parts: msg.parts,
      metadata: msg.metadata ?? null,
    })
    .onConflictDoNothing({ target: messages.id })
    .run();
  db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId)).run();
}
