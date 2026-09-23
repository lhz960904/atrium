import type { Runner } from '@main/agent/runtime/runner';
import { Refusal } from '@main/utils/refusal';
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

const t = initTRPC.context<Context>().create({ isServer: true });

/**
 * A store's refusal, in the code a client understands.
 *
 * Stores throw refusals in their own words and know nothing about status codes;
 * this is the one place the two vocabularies meet, so no procedure needs a
 * try/catch to say the same thing again. Anything that is not a refusal is a
 * fault and travels untouched — a bug must never reach a client dressed as a
 * polite 400.
 */
const refusals = t.middleware(async ({ next }) => {
  const result = await next();
  const cause = result.ok ? undefined : result.error.cause;
  if (!(cause instanceof Refusal)) return result;
  throw new TRPCError({
    code: cause.kind === 'collision' ? 'CONFLICT' : 'BAD_REQUEST',
    message: cause.message,
  });
});

export const router = t.router;
export const publicProcedure = t.procedure.use(refusals);
