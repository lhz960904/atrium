import type { PermissionMode } from '@shared/permissions';
import { useEffect } from 'react';
import { usePermissionStore } from '../state/permission-store';
import { useSetting } from './use-setting';

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
  const { value: persistedMode, set: persistMode, isLoading } = useSetting('permissions.mode');
  const mode = usePermissionStore((s) => s.mode);
  const setStore = usePermissionStore((s) => s.setMode);
  const hydrate = usePermissionStore((s) => s.hydrate);

  useEffect(() => {
    if (!isLoading) hydrate(persistedMode);
  }, [isLoading, persistedMode, hydrate]);

  const setMode = (m: PermissionMode): void => {
    setStore(m);
    persistMode(m);
  };

  return { mode, setMode };
}
