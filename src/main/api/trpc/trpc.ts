import type { Runner } from '@main/agent/runtime/runner';
import { createLogger } from '@main/utils/log';
import { messageOf, Refusal } from '@main/utils/refusal';
import { initTRPC, TRPCError } from '@trpc/server';

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

const log = createLogger('api');

const t = initTRPC.context<Context>().create({ isServer: true });

/**
 * What a failed procedure tells the caller, and what it tells us.
 *
 * A refusal is the domain's answer, so it travels as a bad request carrying its
 * own message — one code, because nothing on the other side does anything
 * different with a second one.
 *
 * Anything else is a fault nobody meant. It keeps the internal error it already
 * had, and is logged here with the original throw: until this existed, a bug in
 * a procedure left no trace at all on this side of the boundary.
 */
const failures = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (result.ok) return result;
  const cause = result.error.cause;
  if (cause instanceof Refusal) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: messageOf(cause) });
  }
  if (result.error.code === 'INTERNAL_SERVER_ERROR') {
    log.error(`${path}: ${messageOf(cause ?? result.error)}`, cause ?? result.error);
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(failures);
