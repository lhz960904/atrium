import type { ParseKeys, TFunction } from 'i18next';

/**
 * What to call a provider in this locale. A brand is usually written the same
 * way everywhere, so the shipped name is the answer unless a locale says
 * otherwise under `settings.providers.name.<id>` — which is also why a provider
 * the user defined needs no entry: its name is whatever they typed.
 */
export function providerLabel(t: TFunction, id: string, name: string): string {
  return t(`settings.providers.name.${id}` as ParseKeys, { defaultValue: name });
}
