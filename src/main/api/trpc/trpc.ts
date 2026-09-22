import type { CredentialStore } from '@earendil-works/pi-ai';
import type { Runner } from '@main/agent/runtime/runner';
import type { Db } from '@main/db';
import { initTRPC } from '@trpc/server';

/**
 * tRPC context — what every procedure receives.
 *
 * `db` is the singleton drizzle handle opened at app start. Procedures
 * can read/write directly through it (better-sqlite3 is synchronous).
 * `credentials` is the store the engine resolves requests through, so a key
 * saved here is the key a request uses.
 */
export type Context = {
  runner: Runner;
  db: Db;
  credentials: CredentialStore;
};

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
