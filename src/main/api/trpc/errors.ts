import { TRPCError } from '@trpc/server';

/**
 * The one code a router raises by hand, so a call site reads
 * `throw badRequest('…')` instead of repeating the TRPCError shape.
 *
 * There used to be one of these per code. Only this one is left, because a
 * store's refusal is translated in one middleware now rather than named at
 * every throw — leaving this for the handful of checks a router does itself,
 * where the input never reached a store to be refused by it.
 */
export const badRequest = (message: string): TRPCError =>
  new TRPCError({ code: 'BAD_REQUEST', message });
