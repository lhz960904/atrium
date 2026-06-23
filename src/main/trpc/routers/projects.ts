import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import { projects, threads } from '../../db/schema';
import { publicProcedure, router } from '../trpc';

export const projectsRouter = router({
  /** Active (non-archived) projects; the sidebar sorts them by recency client-side. */
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(projects).where(isNull(projects.archivedAt)).all(),
  ),

  /** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
  pickDirectory: publicProcedure.mutation(async () => {
    const opts: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  }),

  /**
   * Add a directory as a project. Path is unique: re-adding an existing one
   * returns it (reviving it if it was archived) instead of erroring.
   */
  add: publicProcedure.input(z.object({ path: z.string().min(1) })).mutation(({ ctx, input }) => {
    const existing = ctx.db.select().from(projects).where(eq(projects.path, input.path)).get();
    if (existing) {
      if (existing.archivedAt) {
        ctx.db.update(projects).set({ archivedAt: null }).where(eq(projects.id, existing.id)).run();
      }
      return { id: existing.id };
    }
    const id = randomUUID();
    ctx.db
      .insert(projects)
      .values({ id, path: input.path, name: basename(input.path) })
      .run();
    return { id };
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      ctx.db.update(projects).set({ name: input.name }).where(eq(projects.id, input.id)).run();
    }),

  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(projects).set({ pinned: true }).where(eq(projects.id, input.id)).run();
  }),

  unpin: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.update(projects).set({ pinned: false }).where(eq(projects.id, input.id)).run();
  }),

  /**
   * Archive a project together with its still-active threads, dropping the whole
   * group from the sidebar. To restore, re-add the folder (add revives the
   * project); its threads stay archived but become restorable under it again.
   */
  archive: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const now = new Date();
    ctx.db.transaction((tx) => {
      tx.update(projects).set({ archivedAt: now }).where(eq(projects.id, input.id)).run();
      tx.update(threads)
        .set({ archivedAt: now })
        .where(and(eq(threads.projectId, input.id), isNull(threads.archivedAt)))
        .run();
    });
  }),

  /**
   * Permanently delete a project and every thread under it (messages and
   * artifacts cascade from the thread rows). project_id carries no FK, so the
   * thread deletion is done explicitly here.
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    ctx.db.transaction((tx) => {
      tx.delete(threads).where(eq(threads.projectId, input.id)).run();
      tx.delete(projects).where(eq(projects.id, input.id)).run();
    });
  }),
});
