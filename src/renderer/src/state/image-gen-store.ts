import { create } from 'zustand';

/**
 * Whether a thread is mid image-generation right now, keyed by threadId. Fed by
 * the Chat's onData handler (chat-store) from transient `data-imageGeneration`
 * events, read by the chat view to show a "generating image…" indicator while a
 * direct image-model turn runs (it streams only the image at the end, so the
 * message is otherwise empty). Transient — never persisted; cleared on `done`.
 */
type ImageGenState = {
  active: Record<string, boolean>;
  setActive: (threadId: string, active: boolean) => void;
};

export const useImageGenStore = create<ImageGenState>((set) => ({
  active: {},
  setActive: (threadId, active) => set((s) => ({ active: { ...s.active, [threadId]: active } })),
}));
