import {
  SETTINGS_DEFAULTS,
  type SettingPath,
  type SettingsPatch,
  type SettingValue,
} from '@shared/settings';
import { trpc } from './trpc';

/**
 * Read + write a single persisted setting by dot-path (e.g. `permissions.mode`).
 * Backed by the one `settings.all` query (React Query dedupes it across every
 * caller) and the generic `settings.patch` mutation — so a new setting needs no
 * new hook, store, or procedure. The write updates the cache optimistically,
 * then revalidates, so every component bound to the same path updates at once.
 */
export function useSetting<P extends SettingPath>(
  path: P,
): { value: SettingValue<P>; set: (value: SettingValue<P>) => void; isLoading: boolean } {
  const utils = trpc.useUtils();
  const all = trpc.settings.all.useQuery();
  const patch = trpc.settings.patch.useMutation();

  // Paths are scope.key today (see SettingPath); split once here.
  const [scope, key] = path.split('.') as [keyof typeof SETTINGS_DEFAULTS, string];
  const scopeData = (all.data?.[scope] ?? SETTINGS_DEFAULTS[scope]) as Record<string, unknown>;
  const value = scopeData[key] as SettingValue<P>;

  const set = (next: SettingValue<P>): void => {
    utils.settings.all.setData(undefined, (prev) => {
      const base = prev ?? SETTINGS_DEFAULTS;
      return { ...base, [scope]: { ...(base[scope] as object), [key]: next } };
    });
    patch.mutate({ [scope]: { [key]: next } } as SettingsPatch, {
      onSettled: () => utils.settings.all.invalidate(),
    });
  };

  return { value, set, isLoading: all.isLoading };
}
