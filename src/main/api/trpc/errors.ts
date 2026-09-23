import { TRPCError } from '@trpc/server';

/**
 * Small constructors for the tRPC error codes routers raise, so call sites read
 * `throw badRequest('…')` instead of repeating the `new TRPCError({ code, message })`
 * shape. Only the codes actually used across routers are exposed; add more as needed.
 */
export const badRequest = (message: string): TRPCError =>
  new TRPCError({ code: 'BAD_REQUEST', message });

export const conflict = (message: string): TRPCError =>
  new TRPCError({ code: 'CONFLICT', message });

export const preconditionFailed = (message: string): TRPCError =>
  new TRPCError({ code: 'PRECONDITION_FAILED', message });

export const internalError = (message: string): TRPCError =>
  new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });

/**
 * Turn the refusals a store may raise into the codes a client understands.
 *
 * A store refuses in its own words — a name is taken, a config cannot be
 * accepted, a provisioned server is not the user's to edit — and knows nothing
 * about status codes. Which code each becomes is the transport's business, so
 * the mapping is stated here, once per router, instead of a try/catch around
 * every procedure that could hit one.
 *
 * Anything not listed is a fault rather than a refusal and is left to travel as
 * an internal error.
 */
export function refusing(
  ...cases: Array<[new (...args: never[]) => Error, (message: string) => TRPCError]>
) {
  return <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      for (const [refusal, code] of cases) {
        if (error instanceof refusal) throw code(error.message);
      }
      throw error;
    }
  };
}
