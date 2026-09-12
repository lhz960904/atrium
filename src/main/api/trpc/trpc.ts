import type { Db } from '@main/db';
import { initTRPC } from '@trpc/server';
import type { ChatEndpoint } from '../http';

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
};

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
