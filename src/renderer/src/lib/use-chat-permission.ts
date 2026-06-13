import type { PermissionMode } from '@shared/permissions';
import { useEffect } from 'react';
import { usePermissionStore } from '../state/permission-store';
import { trpc } from './trpc';

/**
 * Hydrate the permission-mode store from the persisted setting once — globally,
 * via the store's `hydrated` flag, not a per-instance ref — and persist changes.
 * The chat transport reads the store live, so once hydrated the store is the
 * single source of truth: a remounted picker (e.g. after visiting Settings or
 * navigating to a new thread) won't snap back to a stale persisted value.
 * Mirrors useChatModel.
 */
export function useChatPermission(): {
  mode: PermissionMode;
  setMode: (m: PermissionMode) => void;
} {
  const utils = trpc.useUtils();
  const persisted = trpc.settings.permissionMode.useQuery();
  const persist = trpc.settings.setPermissionMode.useMutation({
    onSuccess: () => utils.settings.permissionMode.invalidate(),
  });
  const mode = usePermissionStore((s) => s.mode);
  const setStore = usePermissionStore((s) => s.setMode);
  const hydrate = usePermissionStore((s) => s.hydrate);

  useEffect(() => {
    if (persisted.data) hydrate(persisted.data);
  }, [persisted.data, hydrate]);

  const setMode = (m: PermissionMode): void => {
    setStore(m);
    persist.mutate({ mode: m });
  };

  return { mode, setMode };
}
