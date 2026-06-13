import type { UIMessage } from 'ai';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { messages, providers, threads } from '../db/schema';

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
 * Persist one UIMessage into a thread, storing its parts verbatim (the
 * canonical message shape). Idempotent on message id so re-sends / retries
 * don't duplicate. Bumps the thread's updatedAt so the sidebar re-sorts.
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
  const now = new Date();
  // Sending counts as reading: stamp lastReadAt = updatedAt for the user's own
  // message so a thread never flashes "unread" from your own send (only a later
  // assistant turn bumps updatedAt past lastReadAt).
  const bump = msg.role === 'user' ? { updatedAt: now, lastReadAt: now } : { updatedAt: now };
  db.update(threads).set(bump).where(eq(threads.id, threadId)).run();
}

/**
 * Insert a message or overwrite an existing one's parts/metadata in place. Two
 * cases need the overwrite, both keyed on a reused message id: the client
 * re-sends an assistant message whose client-side tool (ask_clarification) just
 * got its answer, and the model continues that same assistant message after the
 * answer (the AI SDK extends it under the same id rather than minting a new
 * one). Insert-and-ignore would silently drop the continuation.
 */
export function upsertMessage(db: Db, threadId: string, msg: UIMessage): void {
  db.insert(messages)
    .values({
      id: msg.id,
      threadId,
      role: msg.role,
      parts: msg.parts,
      metadata: msg.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: messages.id,
      set: { parts: msg.parts, metadata: msg.metadata ?? null },
    })
    .run();
  db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId)).run();
}

/** The user's ACP launch overrides for a local-cli provider (blank = manifest default). */
export function readAcpConfig(db: Db, providerId: string): { command?: string; args?: string } {
  const row = db
    .select({ config: providers.config })
    .from(providers)
    .where(eq(providers.id, providerId))
    .get();
  const cfg = (row?.config ?? null) as { command?: string; args?: string } | null;
  return { command: cfg?.command, args: cfg?.args };
}

type AcpBinding = { providerId: string; sessionId: string };

/** The external ACP session this thread is bound to (provider + agent session id). */
export function readAcpBinding(db: Db, threadId: string): AcpBinding | null {
  const row = db
    .select({ metadata: threads.metadata })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  const meta = (row?.metadata ?? null) as { acpSession?: AcpBinding } | null;
  return meta?.acpSession ?? null;
}

/**
 * Bind a thread to an external ACP session so a later app run can resume the
 * agent's context via session/load. Merges into existing metadata; doesn't bump
 * updatedAt (an internal binding, not a user-visible change).
 */
export function writeAcpBinding(
  db: Db,
  threadId: string,
  providerId: string,
  sessionId: string,
): void {
  const row = db
    .select({ metadata: threads.metadata })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  db.update(threads)
    .set({ metadata: { ...meta, acpSession: { providerId, sessionId } } })
    .where(eq(threads.id, threadId))
    .run();
}

/**
 * Fill a client-side tool call's result into the stored message without running
 * the model — used when a clarification is cancelled: the call must be resolved
 * (so the next turn's history isn't a dangling tool_use) but no continuation
 * should fire until the user sends again.
 */
export function resolveToolOutput(
  db: Db,
  threadId: string,
  toolCallId: string,
  output: unknown,
): void {
  const msg = loadThreadMessages(db, threadId).find((m) =>
    m.parts.some((p) => (p as { toolCallId?: string }).toolCallId === toolCallId),
  );
  if (!msg) return;
  const parts = msg.parts.map((p) =>
    (p as { toolCallId?: string }).toolCallId === toolCallId
      ? { ...p, state: 'output-available', output }
      : p,
  ) as UIMessage['parts'];
  upsertMessage(db, threadId, { ...msg, parts });
}

/** Replace a thread's title with the model-generated summary of its first message. */
export function setThreadTitle(db: Db, threadId: string, title: string): void {
  db.update(threads).set({ title }).where(eq(threads.id, threadId)).run();
}
