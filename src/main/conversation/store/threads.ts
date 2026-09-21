import { randomUUID } from 'node:crypto';
import type { Db } from '@main/db';
import { projects, threads } from '@main/db/schema';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';

/**
 * The thread rows, and every rule about them.
 *
 * A thread row is what the product sorts, pins, archives and marks unread by;
 * the conversation it names lives in the session store. They are one to one, so
 * the two are almost always touched together — but they are kept in separate
 * storage on purpose: these rows are ours to migrate, the session's are pi's,
 * and listing a sidebar full of threads must not mean opening every session.
 *
 * Every write to the table goes through here. It used to happen in five places
 * across four modules, which meant rules like "unarchiving a thread revives the
 * project it is filed under" existed only inside an HTTP handler and could not
 * be reused or tested.
 *
 * Deleting is a mark, never a DELETE. The row and the session it names carry
 * what the conversation cost, and a bill has to outlive the chat it was run
 * up on — so every read here filters the deleted out instead, and nothing
 * above this file has to remember that they exist.
 */

export type Thread = typeof threads.$inferSelect;

/** A thread's bound model; both null means it inherits the default. */
export type ThreadModel = { providerId: string; modelId: string } | null;

/**
 * What a write runs on: the store's own handle, or a caller's transaction when
 * the change has to commit with writes to another table. Drizzle's transaction
 * exposes the same query surface, so the methods do not care which they get.
 */
type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export class ThreadStore {
  constructor(private readonly db: Db) {}

  /** A thread the product can still see. Every read is scoped by this. */
  private alive(...more: (SQL | undefined)[]): SQL | undefined {
    return and(isNull(threads.deletedAt), ...more);
  }

  /** Active threads, most recently updated first — the sidebar's list. */
  list(): Thread[] {
    return this.db
      .select()
      .from(threads)
      .where(this.alive(isNull(threads.archivedAt)))
      .orderBy(desc(threads.updatedAt))
      .all();
  }

  get(id: string): Thread | undefined {
    return this.db
      .select()
      .from(threads)
      .where(this.alive(eq(threads.id, id)))
      .get();
  }

  /**
   * The workspace root a thread runs in: its project's directory, or the
   * fallback when it has no project, or the project was deleted. Every file
   * tool, the sandbox and the system prompt for a turn scope to this.
   */
  workspaceRoot(id: string, fallback: string): string {
    const row = this.db
      .select({ projectId: threads.projectId })
      .from(threads)
      .where(this.alive(eq(threads.id, id)))
      .get();
    if (!row?.projectId) return fallback;
    const project = this.db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .get();
    return project?.path ?? fallback;
  }

  create(input: { title?: string; projectId?: string; model?: ThreadModel } = {}): string {
    const id = randomUUID();
    this.db
      .insert(threads)
      .values({
        id,
        title: input.title ?? null,
        projectId: input.projectId ?? null,
        modelProviderId: input.model?.providerId ?? null,
        modelId: input.model?.modelId ?? null,
      })
      .run();
    return id;
  }

  /**
   * The thread a scheduled task appends to, carrying the task id so the sidebar
   * can tell it from a plain chat.
   */
  createForTask(task: { id: string; title: string; projectId?: string | null }): string {
    const id = randomUUID();
    this.db
      .insert(threads)
      .values({
        id,
        title: task.title,
        projectId: task.projectId ?? null,
        metadata: { scheduledTaskId: task.id },
      })
      .run();
    return id;
  }

  /**
   * Move a thread to the top of the sidebar. `markRead` also clears its unread
   * dot, which is right whenever the write was the user's own doing — their own
   * message, or a turn they stopped while watching it.
   */
  touch(id: string, opts: { markRead?: boolean } = {}): void {
    const now = new Date();
    this.db
      .update(threads)
      .set(opts.markRead ? { updatedAt: now, lastReadAt: now } : { updatedAt: now })
      .where(eq(threads.id, id))
      .run();
  }

  /** Replace the title with the model-generated summary of the first message. */
  setTitle(id: string, title: string): void {
    this.db.update(threads).set({ title }).where(eq(threads.id, id)).run();
  }

  /**
   * Rename a thread; bumps updatedAt so it floats to the top of the sidebar.
   * Advance lastReadAt in lockstep — a rename is a deliberate edit by someone
   * viewing the thread, so it must not trip the unread dot the way new activity
   * does.
   */
  rename(id: string, title: string): void {
    const now = new Date();
    this.db
      .update(threads)
      .set({ title, updatedAt: now, lastReadAt: now })
      .where(eq(threads.id, id))
      .run();
  }

  /** Mark a thread read up to now, clearing its sidebar unread dot. */
  markRead(id: string): void {
    this.db.update(threads).set({ lastReadAt: new Date() }).where(eq(threads.id, id)).run();
  }

  /** Bind (or clear) the thread's model. Deliberately not activity, so
   *  updatedAt is left alone — picking a model must not reorder the sidebar. */
  setModel(id: string, model: ThreadModel): void {
    this.db
      .update(threads)
      .set({ modelProviderId: model?.providerId ?? null, modelId: model?.modelId ?? null })
      .where(eq(threads.id, id))
      .run();
  }

  /** The conversation this thread's messages live in, once it has run. */
  sessionId(id: string): string | undefined {
    const row = this.db
      .select({ sessionId: threads.sessionId })
      .from(threads)
      .where(this.alive(eq(threads.id, id)))
      .get();
    return row?.sessionId ?? undefined;
  }

  bindSession(id: string, sessionId: string): void {
    this.db.update(threads).set({ sessionId }).where(eq(threads.id, id)).run();
  }

  /** Archive a thread — drops it from the sidebar without deleting it. */
  archive(id: string): void {
    this.db.update(threads).set({ archivedAt: new Date() }).where(eq(threads.id, id)).run();
  }

  /**
   * Restore an archived thread. If its project was archived too, revive that as
   * well: a thread filed under a hidden project would come back invisible.
   */
  unarchive(id: string): void {
    const row = this.db
      .select({ projectId: threads.projectId })
      .from(threads)
      .where(this.alive(eq(threads.id, id)))
      .get();
    this.db
      .update(threads)
      .set({ archivedAt: null })
      .where(this.alive(eq(threads.id, id)))
      .run();
    if (row?.projectId) {
      this.db
        .update(projects)
        .set({ archivedAt: null })
        .where(eq(projects.id, row.projectId))
        .run();
    }
  }

  /** Whether the thread is out of the sidebar — a scheduled task rotates off it. */
  isArchived(id: string): boolean {
    const row = this.db
      .select({ archivedAt: threads.archivedAt })
      .from(threads)
      .where(this.alive(eq(threads.id, id)))
      .get();
    return row === undefined || row.archivedAt != null;
  }

  pin(id: string, pinned: boolean): void {
    this.db.update(threads).set({ pinned }).where(eq(threads.id, id)).run();
  }

  /**
   * Delete a thread, as far as anyone above here can tell. The row and its
   * session stay so the usage they account for survives; nothing reads them
   * again, because every read in this file is scoped to the living.
   */
  remove(id: string): void {
    this.db
      .update(threads)
      .set({ deletedAt: new Date() })
      .where(this.alive(eq(threads.id, id)))
      .run();
  }

  /**
   * Archive every still-active thread filed under a project, as part of
   * archiving the project itself — so the caller passes the transaction that
   * change commits in.
   */
  archiveUnderProject(projectId: string, at: Date, exec: Executor = this.db): void {
    exec
      .update(threads)
      .set({ archivedAt: at })
      .where(and(eq(threads.projectId, projectId), isNull(threads.archivedAt)))
      .run();
  }

  /** Delete every thread filed under a project, with the project itself. */
  removeUnderProject(projectId: string, exec: Executor = this.db): void {
    exec
      .update(threads)
      .set({ deletedAt: new Date() })
      .where(and(eq(threads.projectId, projectId), isNull(threads.deletedAt)))
      .run();
  }
}

let instance: ThreadStore | undefined;

/** Install the process's thread store, over the database opened at boot. */
export function openThreadStore(db: Db): void {
  instance = new ThreadStore(db);
}

export function closeThreadStore(): void {
  instance = undefined;
}

export function threadStore(): ThreadStore {
  if (!instance) throw new Error('thread store not initialized — call openDb() first');
  return instance;
}
