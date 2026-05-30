import { create } from 'zustand';

/**
 * One-shot draft carried from the home composer into a freshly created
 * thread. The chat view consumes + clears it on mount and auto-sends it.
 */
type PendingInputStore = {
  text: string | null;
  set: (text: string) => void;
  consume: () => string | null;
};

export const usePendingInput = create<PendingInputStore>((set, get) => ({
  text: null,
  set: (text) => set({ text }),
  consume: () => {
    const { text } = get();
    if (text !== null) set({ text: null });
    return text;
  },
}));
