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
