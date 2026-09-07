import { randomUUID } from 'node:crypto';
import type { AtriumUIMessage } from '@shared/chat';
import type { Message } from '@shared/protocol';

import { asc, eq, or } from 'drizzle-orm';
import { withModelAttachments } from '../agent/pi/attachments';
import type { Checkpoint } from '../agent/pi/compaction';
import { sealDanglingToolCalls } from '../agent/pi/history';
import type { Db } from '../db';
import { messages, projects, threads } from '../db/schema';
import {
  mergeAssistantMessage,
  mergeUserMessage,
  type PiRow,
  splitAssistantMessage,
  splitUserMessage,
} from './persist-convert';

/**
 * The workspace root a thread runs in: its project's directory, or the
 * projectless fallback when it has no project (or the project was deleted).
 * All file tools, the sandbox, and the system prompt for a turn scope to this.
 */
export function resolveThreadWorkspace(db: Db, threadId: string, projectlessRoot: string): string {
  const row = db
    .select({ projectId: threads.projectId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  if (!row?.projectId) return projectlessRoot;
  const project = db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .get();
  return project?.path ?? projectlessRoot;
}

export type MessageRow = typeof messages.$inferSelect;

const toPiRow = (row: MessageRow): PiRow => ({
  id: row.id,
  runId: row.runId as string,
  role: row.role as PiRow['role'],
  message: row.parts as PiRow['message'],
  metadata: (row.metadata as Record<string, unknown> | null) ?? null,
});

/**
 * Load a thread's messages from the DB as UIMessages, oldest first. Rows come
 * in two generations: pi-native rows (runId set — one pi message each, a run's
 * assistant + toolResult rows contiguous by createdAt) merge back into the
 * run-shaped message, and legacy rows (runId null) pass through verbatim.
 */
export function loadThreadMessages(db: Db, threadId: string): AtriumUIMessage[] {
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt))
    .all();

  const out: AtriumUIMessage[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row.runId) {
      out.push({
        id: row.id,
        role: row.role as AtriumUIMessage['role'],
        parts: row.parts as AtriumUIMessage['parts'],
        metadata: row.metadata ?? undefined,
      });
      i++;
      continue;
    }
    const runId = row.runId;
    const group: PiRow[] = [];
    while (i < rows.length && rows[i].runId === runId) group.push(toPiRow(rows[i++]));
    // The vendored AtriumUIMessage and the SDK's AtriumUIMessage are structurally
    // interchangeable; the engine boundary keeps the SDK type until phase 2.
    out.push(
      (group[0].role === 'user'
        ? mergeUserMessage(group[0])
        : mergeAssistantMessage(runId, group)) as unknown as AtriumUIMessage,
    );
  }
  return out;
}

const kindOf = (row: MessageRow): string | undefined =>
  (row.metadata as { kind?: string } | null)?.kind;

const isCheckpointRow = (row: MessageRow): boolean => {
  const kind = kindOf(row);
  return kind === 'compaction' || kind === 'compaction-ack';
};

/**
 * Collapse the stored rows at the latest compaction checkpoint — the fold the
 * engine runs on, while the folded rows themselves stay in the DB for the UI.
 *
 * Reconstructed by id, not by position: a checkpoint is written with the
 * current timestamp so it always sorts newest and can never sit between the
 * folded region and the kept tail. We locate the last folded row through
 * `coveredThroughId`, keep everything after it, and put the checkpoint pair in
 * front — order-independent.
 */
export function applyCheckpoint(rows: MessageRow[]): MessageRow[] {
  let checkpoint: MessageRow | undefined;
  let ack: MessageRow | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    const kind = kindOf(rows[i]);
    if (!checkpoint && kind === 'compaction') checkpoint = rows[i];
    if (!ack && kind === 'compaction-ack') ack = rows[i];
  }
  if (!checkpoint) return rows;

  const coveredThroughId = (checkpoint.metadata as { coveredThroughId?: string })?.coveredThroughId;
  const covered = rows.findIndex((r) => r.id === coveredThroughId);
  // The covered row is gone (the message was edited away). Fall back to the
  // checkpoint's own stored position: everything written after it still stands,
  // and what came before is what the summary was for anyway.
  if (covered < 0) return rows.slice(rows.indexOf(checkpoint));
  const tail = rows.slice(covered + 1).filter((r) => !isCheckpointRow(r));
  return ack ? [checkpoint, ack, ...tail] : [checkpoint, ...tail];
}

/** One stored row's worth of transcript, keeping the row id the checkpoint addresses it by. */
export type HistoryEntry = { id: string; message: Message };

/**
 * Re-attach row ids after sealing, which only ever inserts. The originals come
 * back by identity; a synthesized result inherits the id of the row whose
 * unanswered call it closes — it has no row of its own, and a checkpoint that
 * folded through it has to name something the next read can still find.
 */
function sealHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const sealed = sealDanglingToolCalls(entries.map((e) => e.message));
  const out: HistoryEntry[] = [];
  let i = 0;
  for (const message of sealed) {
    if (entries[i]?.message === message) out.push(entries[i++]);
    else out.push({ id: out[out.length - 1].id, message });
  }
  return out;
}

/**
 * A thread's transcript as pi messages — what the engine actually runs on, read
 * straight from the rows with no AtriumUIMessage round-trip, folded at its latest
 * compaction checkpoint. Rows written before the format flip still hold UI
 * parts, so those pass through the split converters on the way out. Dangling
 * tool calls are sealed here rather than at write time too: a row group can
 * also be left half-written by a crash, and a provider rejects the whole
 * request over one unpaired tool call.
 */
export function loadThreadHistory(db: Db, threadId: string): HistoryEntry[] {
  const rows = applyCheckpoint(
    db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))
      .all(),
  );

  const out: HistoryEntry[] = [];
  for (const row of rows) {
    if (row.runId) {
      out.push({ id: row.id, message: row.parts as Message });
      continue;
    }
    const legacy = {
      id: row.id,
      role: row.role as AtriumUIMessage['role'],
      parts: row.parts as AtriumUIMessage['parts'],
      metadata: row.metadata ?? undefined,
    } as AtriumUIMessage;
    if (legacy.role === 'user') out.push({ id: row.id, message: splitUserMessage(legacy).message });
    else if (legacy.role === 'assistant')
      for (const piRow of splitAssistantMessage(legacy))
        out.push({ id: row.id, message: piRow.message });
  }
  return sealHistory(out).map((e) => ({ ...e, message: withModelAttachments(e.message) }));
}

export function loadThreadAgentMessages(db: Db, threadId: string): Message[] {
  return loadThreadHistory(db, threadId).map((e) => e.message);
}

/**
 * The rows one run already wrote, oldest first. A run is replaced whole on
 * write, so a continuation has to carry its earlier turns along — and the
 * calls among them that never got a result are the ones waiting on the user.
 */
export function loadRunRows(db: Db, runId: string): RunRow[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.runId, runId))
    .orderBy(asc(messages.createdAt))
    .all()
    .filter((row) => row.role === 'assistant' || row.role === 'toolResult')
    .map((row) => ({
      id: row.id,
      role: row.role as RunRow['role'],
      message: row.parts as Message,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }));
}

/**
 * Store a compaction checkpoint: the summary the model reads in place of the
 * folded history, and the ack that keeps the roles alternating after it. Both
 * are ordinary rows — the transcript keeps its full history, and the reader
 * folds at them.
 */
export function persistCheckpoint(
  db: Db,
  threadId: string,
  checkpoint: Checkpoint,
  coveredThroughId: string,
): void {
  const now = Date.now();
  const summaryId = randomUUID();
  const ackRunId = randomUUID();
  db.transaction((tx) => {
    tx.insert(messages)
      .values({
        id: summaryId,
        threadId,
        role: 'user',
        parts: checkpoint.summary,
        metadata: { kind: 'compaction', coveredThroughId, createdAt: now },
        runId: summaryId,
        createdAt: new Date(now),
      })
      .run();
    tx.insert(messages)
      .values({
        id: `${ackRunId}:0`,
        threadId,
        role: 'assistant',
        parts: checkpoint.ack,
        metadata: { kind: 'compaction-ack', createdAt: now + 1 },
        runId: ackRunId,
        createdAt: new Date(now + 1),
      })
      .run();
  });
  db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId)).run();
}

/**
 * Wire shape of a thread message on the tRPC surface. Deliberately loose:
 * exposing the full AtriumUIMessage generic to tRPC's output inference blows the
 * type-instantiation budget, and the renderer casts parts at its boundary
 * anyway.
 */
export type ThreadMessageDto = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: unknown;
  metadata: unknown;
};

export function loadThreadMessageDtos(db: Db, threadId: string): ThreadMessageDto[] {
  return loadThreadMessages(db, threadId) as ThreadMessageDto[];
}

/** Whether any stored row belongs to this message (either generation). */
function messageExists(db: Db, id: string): boolean {
  return (
    db
      .select({ id: messages.id })
      .from(messages)
      .where(or(eq(messages.runId, id), eq(messages.id, id)))
      .limit(1)
      .get() !== undefined
  );
}

/** The original wall-clock position of a stored message, for rewrites. */
function messageBaseCreatedAt(db: Db, id: string): number | undefined {
  return db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(or(eq(messages.runId, id), eq(messages.id, id)))
    .orderBy(asc(messages.createdAt))
    .limit(1)
    .get()
    ?.createdAt?.getTime();
}

/**
 * Write one run-shaped message as pi-native rows. An assistant run rewrites
 * atomically (delete the run's rows — including a legacy-generation row under
 * the same id — and reinsert), keeping its original chronological position;
 * per-row createdAt offsets preserve in-run order under the createdAt sort.
 */
function writePiMessage(db: Db, threadId: string, msg: AtriumUIMessage, overwrite: boolean): void {
  if (msg.role === 'user') {
    const row = splitUserMessage(msg as AtriumUIMessage);
    const values = {
      id: row.id,
      threadId,
      role: 'user' as const,
      parts: row.message,
      metadata: row.metadata,
      runId: row.runId,
    };
    const insert = db.insert(messages).values(values);
    if (overwrite) {
      insert
        .onConflictDoUpdate({
          target: messages.id,
          set: { parts: row.message, metadata: row.metadata, runId: row.runId },
        })
        .run();
    } else {
      insert.onConflictDoNothing({ target: messages.id }).run();
    }
    return;
  }

  if (msg.role !== 'assistant') {
    // System rows have no pi vocabulary; store them as legacy rows unchanged.
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
    return;
  }

  if (!overwrite && messageExists(db, msg.id)) return;
  const base = messageBaseCreatedAt(db, msg.id) ?? Date.now();
  const rows = splitAssistantMessage(msg as AtriumUIMessage);
  db.transaction((tx) => {
    tx.delete(messages)
      .where(or(eq(messages.runId, msg.id), eq(messages.id, msg.id)))
      .run();
    rows.forEach((row, index) => {
      tx.insert(messages)
        .values({
          id: row.id,
          threadId,
          role: row.role,
          parts: row.message,
          metadata: row.metadata,
          runId: row.runId,
          createdAt: new Date(base + index),
        })
        .run();
    });
  });
}

/**
 * One pi message a run produced, ready to become a row. `id` is the row key:
 * `<runId>:<turn>` for an assistant turn, the tool call id for its results —
 * the same keys the split converters have always written.
 */
export type RunRow = {
  id: string;
  role: 'assistant' | 'toolResult';
  message: Message;
  metadata?: Record<string, unknown> | null;
};

/**
 * Write a run's pi messages as its rows, replacing whatever the run had before.
 * The whole run lands in one transaction so a reader never sees half a turn,
 * and the group keeps its original chronological position: a continuation (the
 * model resuming the same run after a client-side tool answer) must stay where
 * the run started, not jump to the end of the thread. Per-row createdAt offsets
 * preserve in-run order under the createdAt sort.
 */
export function persistRun(
  db: Db,
  threadId: string,
  runId: string,
  rows: RunRow[],
  opts?: { markRead?: boolean },
): void {
  const base = messageBaseCreatedAt(db, runId) ?? Date.now();
  db.transaction((tx) => {
    tx.delete(messages)
      .where(or(eq(messages.runId, runId), eq(messages.id, runId)))
      .run();
    rows.forEach((row, index) => {
      tx.insert(messages)
        .values({
          id: row.id,
          threadId,
          role: row.role,
          parts: row.message,
          metadata: row.metadata ?? null,
          runId,
          createdAt: new Date(base + index),
        })
        .run();
    });
  });
  const now = new Date();
  // markRead stamps lastReadAt = updatedAt so a stopped turn's partial write
  // can't trip the sidebar's unread dot on the thread the user is watching.
  const bump = opts?.markRead ? { updatedAt: now, lastReadAt: now } : { updatedAt: now };
  db.update(threads).set(bump).where(eq(threads.id, threadId)).run();
}

/**
 * Persist one AtriumUIMessage into a thread, storing its parts verbatim (the
 * canonical message shape). Idempotent on message id so re-sends / retries
 * don't duplicate. Bumps the thread's updatedAt so the sidebar re-sorts.
 */
export function persistMessage(db: Db, threadId: string, msg: AtriumUIMessage): void {
  writePiMessage(db, threadId, msg, false);
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
 * answer (the continuation extends it under the same id rather than minting a
 * new one). Insert-and-ignore would silently drop it.
 */
export function upsertMessage(
  db: Db,
  threadId: string,
  msg: AtriumUIMessage,
  opts?: { markRead?: boolean },
): void {
  writePiMessage(db, threadId, msg, true);
  const now = new Date();
  // markRead stamps lastReadAt = updatedAt so this write can't trip the sidebar's
  // unread dot — used when the user stops a turn, since the partial message is
  // persisted on a thread they're actively viewing.
  const bump = opts?.markRead ? { updatedAt: now, lastReadAt: now } : { updatedAt: now };
  db.update(threads).set(bump).where(eq(threads.id, threadId)).run();
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
  ) as AtriumUIMessage['parts'];
  upsertMessage(db, threadId, { ...msg, parts });
}

/** Replace a thread's title with the model-generated summary of its first message. */
export function setThreadTitle(db: Db, threadId: string, title: string): void {
  db.update(threads).set({ title }).where(eq(threads.id, threadId)).run();
}
