import type { UpdaterState } from '@shared/update';
import { create } from 'zustand';

/**
 * Mirror of the main-process updater state, kept in sync by the `update:state`
 * broadcast (seeded once from the getState query on mount). Ephemeral by design —
 * never persisted; a fresh launch re-derives it from the next check. `dialogOpen`
 * is renderer-only: the Update entry opens the dialog, it doesn't change updater
 * state.
 */
const INITIAL: UpdaterState = {
  stage: 'idle',
  currentVersion: '',
  info: null,
  progress: null,
  error: null,
};

type UpdateStore = {
  state: UpdaterState;
  dialogOpen: boolean;
  setState: (state: UpdaterState) => void;
  openDialog: () => void;
  closeDialog: () => void;
};

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: INITIAL,
  dialogOpen: false,
  setState: (state) => set({ state }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));
