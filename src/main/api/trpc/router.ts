import { browserRouter } from './routers/browser';
import { chatRouter } from './routers/chat';
import { computerRouter } from './routers/computer';
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
import { updateRouter } from './routers/update';
import { usageRouter } from './routers/usage';
import { router } from './trpc';

/**
 * Root tRPC router: the sub-routers under `./routers/*`, and nothing else.
 *
 * Nothing lives here directly. A procedure belongs to the area it is about, and
 * this file only says which areas there are.
 */
export const appRouter = router({
  chat: chatRouter,
  threads: threadsRouter,
  messages: messagesRouter,
  models: modelsRouter,
  mcp: mcpRouter,
  browser: browserRouter,
  computer: computerRouter,
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
  update: updateRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
