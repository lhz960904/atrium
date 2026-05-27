import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = () =>
  integer({ mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);

export const threads = sqliteTable('threads', {
  id: text().primaryKey(),
  title: text(),
  projectId: text('project_id'),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

export const messages = sqliteTable('messages', {
  id: text().primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  role: text({ enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
  content: text({ mode: 'json' }).notNull(),
  createdAt: timestamp(),
});

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

export const todos = sqliteTable('todos', {
  id: text().primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  content: text().notNull(),
  status: text({ enum: ['pending', 'in_progress', 'completed'] })
    .notNull()
    .default('pending'),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
