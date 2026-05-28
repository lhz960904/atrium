import { MOCK_THREADS } from '@shared/mock-threads';
import type { Db } from './index';
import { messages, threads } from './schema';

/**
 * Populate an empty dev database with the mock threads from
 * `src/shared/mock-threads.ts` so the renderer has something to render
 * while the agent loop is not yet wired up.
 *
 * Idempotent at startup: caller checks `threads` is empty before invoking.
 */
export function seedMockThreads(db: Db): void {
  const baseTime = Date.now() - 60 * 60 * 1000; // 1h ago, leave headroom

  let threadIndex = 0;
  for (const thread of Object.values(MOCK_THREADS)) {
    const threadCreatedAt = new Date(baseTime + threadIndex * 60_000);
    db.insert(threads)
      .values({
        id: thread.id,
        title: thread.title,
        createdAt: threadCreatedAt,
        updatedAt: threadCreatedAt,
      })
      .run();

    let messageIndex = 0;
    for (const msg of thread.messages) {
      const createdAt = new Date(threadCreatedAt.getTime() + messageIndex * 1000);
      const parts =
        msg.role === 'user' ? ({ content: msg.content } as const) : (msg.trace as unknown);
      db.insert(messages)
        .values({
          // mock message ids are only unique within a thread (m-1, m-2 …); the
          // messages table PK is global, so prefix with the thread id.
          id: `${thread.id}__${msg.id}`,
          threadId: thread.id,
          role: msg.role,
          parts,
          createdAt,
        })
        .run();
      messageIndex++;
    }
    threadIndex++;
  }
}
