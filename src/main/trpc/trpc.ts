import { initTRPC } from '@trpc/server';
import type { Db } from '../db';
import type { ChatEndpoint } from '../server/http';

/**
 * tRPC context — what every procedure receives.
 *
 * `db` is the singleton drizzle handle opened at app start. Procedures
 * can read/write directly through it (better-sqlite3 is synchronous).
 * `chatEndpoint` lets the renderer discover the localhost chat server.
 */
export type Context = {
  db: Db;
  chatEndpoint: ChatEndpoint;
  workspaceRoot: string;
};

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
