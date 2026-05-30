import { create } from 'zustand';

export type SelectedModel = { providerId: string; modelId: string };

/**
 * Currently selected chat model, shared between the composer's ModelPicker
 * and the chat view's transport. Hydrated from settings + providers and
 * persisted by `useChatModel`; this store is just the in-memory source of
 * truth both sides read.
 */
type ModelStore = {
  selected: SelectedModel | null;
  setSelected: (m: SelectedModel) => void;
};

export const useModelStore = create<ModelStore>((set) => ({
  selected: null,
  setSelected: (selected) => set({ selected }),
}));
