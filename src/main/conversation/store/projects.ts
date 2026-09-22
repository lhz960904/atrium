import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Db } from '@main/db';
import { projects } from '@main/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { threadStore } from './threads';

/**
 * The project rows, and every rule about them.
 *
 * A project is a directory used as the workspace root for its threads, so
 * archiving or deleting one is never just a write to this table — the threads
 * filed under it move with it, in the same transaction, or the sidebar ends up
 * showing a group whose halves disagree. `project_id` carries no foreign key,
 * which is exactly why the fan-out has to be written down somewhere.
 */

export type Project = typeof projects.$inferSelect;

export class ProjectStore {
  constructor(private readonly db: Db) {}

  /** Active projects; the sidebar sorts them by recency itself. */
  list(): Project[] {
    return this.db.select().from(projects).where(isNull(projects.archivedAt)).all();
  }

  /**
   * Add a directory as a project. The path is the identity, so re-adding one
   * returns what is already there — reviving it when it was archived — rather
   * than making a second project for the same folder.
   */
  add(path: string): string {
    const existing = this.db.select().from(projects).where(eq(projects.path, path)).get();
    if (existing) {
      if (existing.archivedAt) {
        this.db
          .update(projects)
          .set({ archivedAt: null })
          .where(eq(projects.id, existing.id))
          .run();
      }
      return existing.id;
    }
    const id = randomUUID();
    this.db
      .insert(projects)
      .values({ id, path, name: basename(path) })
      .run();
    return id;
  }

  rename(id: string, name: string): void {
    this.db.update(projects).set({ name }).where(eq(projects.id, id)).run();
  }

  pin(id: string, pinned: boolean): void {
    this.db.update(projects).set({ pinned }).where(eq(projects.id, id)).run();
  }

  /**
   * Archive a project together with its still-active threads, dropping the
   * whole group from the sidebar. Restoring is re-adding the folder: the
   * project revives and its threads become restorable under it again.
   */
  archive(id: string): void {
    const now = new Date();
    this.db.transaction((tx) => {
      tx.update(projects).set({ archivedAt: now }).where(eq(projects.id, id)).run();
      threadStore().archiveUnderProject(id, now, tx);
    });
  }

  /**
   * Delete a project and every thread filed under it. The project row does go;
   * its threads are only marked, so the conversations they name — and what
   * those cost — stay.
   */
  remove(id: string): void {
    this.db.transaction((tx) => {
      threadStore().removeUnderProject(id, tx);
      tx.delete(projects).where(eq(projects.id, id)).run();
    });
  }
}

let instance: ProjectStore | undefined;

/** Install the process's project store, over the database opened at boot. */
export function openProjectStore(db: Db): void {
  instance = new ProjectStore(db);
}

export function closeProjectStore(): void {
  instance = undefined;
}

export function projectStore(): ProjectStore {
  if (!instance) throw new Error('project store not initialized — call openDb() first');
  return instance;
}
