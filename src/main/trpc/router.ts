import { app } from 'electron';
import { mcpRouter } from './routers/mcp';
import { memoryRouter } from './routers/memory';
import { messagesRouter } from './routers/messages';
import { modelsRouter } from './routers/models';
import { profileRouter } from './routers/profile';
import { projectsRouter } from './routers/projects';
import { providersRouter } from './routers/providers';
import { scheduledRouter } from './routers/scheduled';
import { searchRouter } from './routers/search';
import { settingsRouter } from './routers/settings';
import { skillsRouter } from './routers/skills';
import { subagentsRouter } from './routers/subagents';
import { systemRouter } from './routers/system';
import { threadsRouter } from './routers/threads';
import { usageRouter } from './routers/usage';
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
  models: modelsRouter,
  mcp: mcpRouter,
  memory: memoryRouter,
  profile: profileRouter,
  projects: projectsRouter,
  search: searchRouter,
  providers: providersRouter,
  scheduled: scheduledRouter,
  settings: settingsRouter,
  skills: skillsRouter,
  subagents: subagentsRouter,
  system: systemRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
