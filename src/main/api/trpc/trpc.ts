import { initTRPC } from '@trpc/server';

/**
 * tRPC context — what every procedure receives, which is nothing.
 *
 * A context is for what varies between requests. Everything a procedure needs
 * here is a process singleton — the database, the credential store, the runner
 * — so each is asked for where it lives (`getDb()`, `credentialStore()`,
 * `runner()`) instead of being couriered through every call.
 */
export type Context = Record<string, never>;

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
