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
  /** When the user archived this thread; null = active. Archived threads drop
   *  out of the sidebar list but stay openable by id and keep their messages. */
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  /** Pinned to the top of the sidebar; the Pinned section mixes pinned threads
   *  and pinned projects. */
  pinned: integer({ mode: 'boolean' }).notNull().default(false),
});

/**
 * A user-added project: a directory used as the workspace root for its threads.
 * Threads reference it via threads.project_id with NO foreign key — delete and
 * archive fan out to the project's threads explicitly in the router, so SQLite
 * never has to rebuild the table to add an FK to an existing column. pinned
 * shares the sidebar's Pinned section with threads; archivedAt mirrors threads.
 */
export const projects = sqliteTable('projects', {
  id: text().primaryKey(),
  path: text().notNull().unique(),
  name: text().notNull(),
  pinned: integer({ mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: timestamp(),
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

/**
 * User-defined and AI-created subagents. Built-in subagents (general-purpose,
 * deep-research) live in code and are never stored here — this table holds only
 * the ones the user adds or the agent creates via createSubAgent. `name` is the
 * unique identifier the parent delegates to; it must not collide with a built-in
 * (built-in vs custom is told apart by membership in the code's built-in map, so
 * no column tracks it). null toolAllow/toolDeny = inherit the parent's tools. A
 * model is identified by a (providerId, modelId) pair — set both to pin this
 * subagent to a specific model, or leave both null to inherit the parent's.
 */
export const subagents = sqliteTable('subagents', {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  description: text().notNull(),
  systemPrompt: text().notNull(),
  toolAllow: text({ mode: 'json' }),
  toolDeny: text({ mode: 'json' }),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

/**
 * One row per MCP (Model Context Protocol) server the user configures. Atrium
 * connects to these as an MCP client and merges their tools into the agent's
 * toolset, namespaced `mcp__<server>__<tool>`. Non-secret config (transport,
 * command/args/url, non-secret env and headers) lives in `config`; secret env
 * vars, headers and tokens are safeStorage-encrypted in `credentialsEncrypted`.
 * `name` is the unique, user-visible identifier that also seeds the namespace.
 */
export const mcpServers = sqliteTable('mcp_servers', {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  enabled: integer({ mode: 'boolean' }).notNull().default(false),
  transport: text({ enum: ['stdio', 'http', 'sse'] }).notNull(),
  config: text({ mode: 'json' }),
  /** safeStorage-encrypted JSON; null when no credentials are stored. */
  credentialsEncrypted: blob('credentials_encrypted', { mode: 'buffer' }),
  /** safeStorage-encrypted OAuth state (DCR client info + tokens); kept apart
   *  from credentials so editing config can't clobber the tokens. */
  oauthEncrypted: blob('oauth_encrypted', { mode: 'buffer' }),
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

/**
 * Per-LLM-call usage ledger: one row per model call (main chat turn, subagent,
 * title, …). Tokens and cost are frozen at write time — cost from the model's
 * pricing at that moment, so a later price change doesn't rewrite history. This
 * is the system of record for the usage/billing page; message metadata stays the
 * live, in-chat readout. threadId set-nulls on thread delete so spend survives.
 */
export const usage = sqliteTable(
  'usage',
  {
    id: text().primaryKey(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    /** The assistant message this call produced; null for non-message calls. */
    messageId: text('message_id'),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    kind: text({ enum: ['chat', 'subagent', 'title', 'summary', 'review'] }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    /** Frozen micro-USD (1e-6 dollar) from the model's pricing at write time. */
    costUsdMicros: integer('cost_usd_micros').notNull().default(0),
    createdAt: timestamp(),
  },
  (table) => [
    index('usage_created_at_idx').on(table.createdAt),
    index('usage_thread_idx').on(table.threadId),
    index('usage_model_idx').on(table.modelId),
  ],
);

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type Subagent = typeof subagents.$inferSelect;
export type NewSubagent = typeof subagents.$inferInsert;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type NewMcpServerRow = typeof mcpServers.$inferInsert;
export type Usage = typeof usage.$inferSelect;
export type NewUsage = typeof usage.$inferInsert;
