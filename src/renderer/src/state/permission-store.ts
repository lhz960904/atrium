import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import { create } from 'zustand';

type PermissionStore = {
  mode: PermissionMode;
  /** True once the store has been seeded from the persisted setting, or the user
   *  has picked a mode. Guards `hydrate` so a remounted picker can't re-seed from
   *  a stale query cache and clobber the live choice. */
  hydrated: boolean;
  setMode: (mode: PermissionMode) => void;
  /** Seed from the persisted setting, but only while still unhydrated — so it
   *  runs once globally no matter how many components mount the hook. */
  hydrate: (mode: PermissionMode) => void;
};

/** The active tool-permission mode, read live per send and shipped to the server
 *  (mirrors the model store). Global for now; per-thread persistence is later. */
export const usePermissionStore = create<PermissionStore>((set, get) => ({
  mode: DEFAULT_PERMISSION_MODE,
  hydrated: false,
  setMode: (mode) => set({ mode, hydrated: true }),
  hydrate: (mode) => {
    if (!get().hydrated) set({ mode, hydrated: true });
  },
}));
