import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../../../main/api/trpc/router';

export type ProviderView = inferRouterOutputs<AppRouter>['providers']['list'][number];

/**
 * The provider whose detail pane is shown: the one picked, else the first, else
 * none at all.
 *
 * "None at all" is the state a fresh install opens in — a provider exists only
 * once the user adds one — so it is a real answer rather than an impossible
 * one, and saying so in the return type is what stops the pane being handed a
 * provider that is not there.
 */
export function selectedProvider(
  providers: ProviderView[],
  selectedId: string | null,
): ProviderView | null {
  return providers.find((provider) => provider.id === selectedId) ?? providers[0] ?? null;
}
