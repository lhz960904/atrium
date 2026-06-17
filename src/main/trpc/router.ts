import { app } from 'electron';
import { messagesRouter } from './routers/messages';
import { profileRouter } from './routers/profile';
import { providersRouter } from './routers/providers';
import { searchRouter } from './routers/search';
import { settingsRouter } from './routers/settings';
import { skillsRouter } from './routers/skills';
import { subagentsRouter } from './routers/subagents';
import { systemRouter } from './routers/system';
import { threadsRouter } from './routers/threads';
import { publicProcedure, router } from './trpc';

/**
 * Root tRPC router.
 *
 * Sub-routers live under `./routers/*` and are spread in here. Keeping
 * the leaf procedures (`ping`) and the assembly in one file is fine while
 * the surface is small; if it grows, split each section into its own file.
 */
export const appRouter = router({
  ping: publicProcedure.query(() => ({
    pong: true,
    at: Date.now(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
  })),
  threads: threadsRouter,
  messages: messagesRouter,
  profile: profileRouter,
  search: searchRouter,
  providers: providersRouter,
  settings: settingsRouter,
  skills: skillsRouter,
  subagents: subagentsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
