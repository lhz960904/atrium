import type { Runner } from '@main/agent/runtime/runner';
import { initTRPC } from '@trpc/server';

/**
 * tRPC context — a procedure's own dependencies.
 *
 * The runner is here because the procedures call it: it is what `chat` is a
 * front for, and handing it in is what lets those procedures be tested against
 * one that does not run anything.
 *
 * The database and the credential store used to ride along too and were only
 * ever passed straight through to a store. Being a singleton was not the
 * reason to drop them — the runner is one as well — being a courier was. They
 * are asked for where they live: `getDb()` and `credentialStore()`.
 */
export type Context = { runner: Runner };

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
