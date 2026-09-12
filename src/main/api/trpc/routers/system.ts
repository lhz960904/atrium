import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const systemRouter = router({
  /** Where the renderer's useChat transport should POST, plus its auth token. */
  chatEndpoint: publicProcedure.query(({ ctx }) => ({
    baseUrl: `http://127.0.0.1:${ctx.chatEndpoint.port}`,
    token: ctx.chatEndpoint.token,
  })),

  /**
   * Native save dialog + write, for renderer-produced text exports (the
   * renderer has no fs access). Returns the written path, or null if the
   * user cancelled.
   */
  saveTextFile: publicProcedure
    .input(
      z.object({
        defaultName: z.string().min(1),
        content: z.string(),
        filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
      }),
    )
    .mutation(async ({ input }) => {
      const opts = { defaultPath: input.defaultName, filters: input.filters };
      const win = BrowserWindow.getFocusedWindow();
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      await writeFile(res.filePath, input.content, 'utf8');
      return res.filePath;
    }),
});
