import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../../main/trpc/router';

export type ProviderView = inferRouterOutputs<AppRouter>['providers']['list'][number];
