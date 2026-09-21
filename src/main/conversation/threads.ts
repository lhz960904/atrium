import type { Fold } from '@main/agent/context/compaction';

import { conversations } from './store/conversation';
import { threadStore } from './store/threads';

/**
 * The two operations that write to both halves of a thread at once.
 *
 * A thread's row and its conversation are kept by separate stores, each of
 * which owns its own writes. What is left here is the pair of changes that are
 * not finished until both have happened — folding a conversation and rewinding
 * it both move the thread up the sidebar, and a caller that did one without the
 * other would leave the list lying about what changed.
 */

/**
 * Record a fold on the thread's conversation. The folded messages stay in the
 * session — only what the model is shown gets shorter, and the reader rebuilds
 * the shorter view from this entry.
 */
export async function compactThread(threadId: string, fold: Fold): Promise<void> {
  const conversation = await conversations().forThread(threadId);
  if (!conversation) return;
  await conversation.appendCompaction(fold);
  threadStore().touch(threadId);
}

/**
 * Take the conversation back to just before one message, so the next turn
 * continues from there — what editing an earlier message and re-running needs.
 *
 * Nothing is deleted. The branch is moved back and the messages after it stay in
 * the session, off to one side, which is both cheaper than a delete and the
 * reason a re-run can never half-truncate a thread.
 */
export async function rewindThread(threadId: string, messageId: string): Promise<boolean> {
  const conversation = await conversations().forThread(threadId);
  if (!conversation) return false;
  // Any run still open would be left dangling past the new leaf; the next run
  // closes it, so there is nothing to do here but move the branch.
  if (!(await conversation.rewindTo(messageId))) return false;
  threadStore().touch(threadId, { markRead: true });
  return true;
}
