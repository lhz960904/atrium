import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import { create } from 'zustand';

type PermissionStore = {
  mode: PermissionMode;
  setMode: (mode: PermissionMode) => void;
};

/** The active tool-permission mode, read live per send and shipped to the server
 *  (mirrors the model store). Global for now; per-thread persistence is later. */
export const usePermissionStore = create<PermissionStore>((set) => ({
  mode: DEFAULT_PERMISSION_MODE,
  setMode: (mode) => set({ mode }),
}));
