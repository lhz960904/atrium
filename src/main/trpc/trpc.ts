import { initTRPC } from '@trpc/server';
import type { Db } from '../db';

/**
 * tRPC context — what every procedure receives.
 *
 * `db` is the singleton drizzle handle opened at app start. Procedures
 * can read/write directly through it (better-sqlite3 is synchronous).
 */
export type Context = {
  db: Db;
};

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
