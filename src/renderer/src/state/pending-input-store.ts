import { create } from 'zustand';

/**
 * One-shot draft carried from the home composer into a freshly created
 * thread's composer. The chat view consumes + clears it on mount. (Auto-send
 * lands in 5.f; for now it just prefills the input.)
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
