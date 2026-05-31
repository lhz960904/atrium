import { sql } from 'drizzle-orm';
import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = () =>
  integer({ mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);

export const threads = sqliteTable('threads', {
  id: text().primaryKey(),
  title: text(),
  projectId: text('project_id'),
  metadata: text({ mode: 'json' }),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  /** When the user last viewed this thread; null = never (treated as read).
   *  A thread is "unread" in the sidebar when updatedAt is newer than this. */
  lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    role: text({ enum: ['system', 'user', 'assistant'] }).notNull(),
    parts: text({ mode: 'json' }).notNull(),
    /** Per-message observability: tokens, model name, finish reason, latency, … */
    metadata: text({ mode: 'json' }),
    createdAt: timestamp(),
  },
  (table) => [index('messages_thread_created_at_idx').on(table.threadId, table.createdAt)],
);

export const artifacts = sqliteTable('artifacts', {
  id: text().primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  type: text({
    enum: ['html', 'code', 'markdown', 'image', 'diff', 'data'],
  }).notNull(),
  name: text().notNull(),
  body: text().notNull(),
  mime: text(),
  createdAt: timestamp(),
});

/**
 * One row per provider the user has interacted with. Static per-provider
 * metadata (display name, icon, kind, default endpoints) lives in
 * `src/main/providers/manifest.ts`; this table only stores the user's actual
 * configuration: whether it's enabled, non-secret config (base URL, visible
 * models, CLI path…), and encrypted credentials.
 */
export const providers = sqliteTable('providers', {
  id: text().primaryKey(),
  enabled: integer({ mode: 'boolean' }).notNull().default(false),
  config: text({ mode: 'json' }),
  /** safeStorage-encrypted JSON; null when no credentials are stored. */
  credentialsEncrypted: blob('credentials_encrypted', { mode: 'buffer' }),
  updatedAt: timestamp(),
});

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
