import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../main/trpc/router';

/**
 * Typed tRPC React client.
 *
 * Usage in components:
 *   const { data } = trpc.threads.list.useQuery();
 *   const create = trpc.threads.create.useMutation();
 *
 * Non-hook access (for one-off calls / event handlers):
 *   const utils = trpc.useUtils();
 *   await utils.threads.list.fetch();
 */
export const trpc = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;
