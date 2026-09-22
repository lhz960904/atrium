import { projectStore } from '@main/conversation/store/projects';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const byId = z.object({ id: z.string() });

export const projectsRouter = router({
  list: publicProcedure.query(() => projectStore().list()),

  /** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
  pickDirectory: publicProcedure.mutation(async () => {
    const opts: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  }),

  add: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(({ input }) => ({ id: projectStore().add(input.path) })),

  rename: publicProcedure
    .input(byId.extend({ name: z.string().min(1) }))
    .mutation(({ input }) => projectStore().rename(input.id, input.name)),

  pin: publicProcedure.input(byId).mutation(({ input }) => projectStore().pin(input.id, true)),

  unpin: publicProcedure.input(byId).mutation(({ input }) => projectStore().pin(input.id, false)),

  archive: publicProcedure.input(byId).mutation(({ input }) => projectStore().archive(input.id)),

  delete: publicProcedure.input(byId).mutation(({ input }) => projectStore().remove(input.id)),
});
