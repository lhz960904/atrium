import { initTRPC } from '@trpc/server';
import { app } from 'electron';

const t = initTRPC.create({ isServer: true });

export const appRouter = t.router({
  ping: t.procedure.query(() => ({
    pong: true,
    at: Date.now(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
  })),
});

export type AppRouter = typeof appRouter;
