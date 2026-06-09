import type { PermissionMode } from '@shared/permissions';
import { useEffect, useRef } from 'react';
import { usePermissionStore } from '../state/permission-store';
import { trpc } from './trpc';

/**
 * Hydrate the permission-mode store from the persisted setting once, and
 * persist changes — so the composer's mode survives a reload instead of
 * snapping back to the default. Mirrors useChatModel; the chat transport reads
 * the store live, so hydrating it here is enough.
 */
export function useChatPermission(): {
  mode: PermissionMode;
  setMode: (m: PermissionMode) => void;
} {
  const persisted = trpc.settings.permissionMode.useQuery();
  const persist = trpc.settings.setPermissionMode.useMutation();
  const mode = usePermissionStore((s) => s.mode);
  const setStore = usePermissionStore((s) => s.setMode);
  const hydrated = useRef(false);

  useEffect(() => {
    if (persisted.isLoading || hydrated.current) return;
    if (persisted.data) setStore(persisted.data);
    hydrated.current = true;
  }, [persisted.isLoading, persisted.data, setStore]);

  const setMode = (m: PermissionMode): void => {
    setStore(m);
    persist.mutate({ mode: m });
  };

  return { mode, setMode };
}
