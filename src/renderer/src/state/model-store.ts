import { create } from 'zustand';

export type SelectedModel = { providerId: string; modelId: string };

/** Sentinel threadId for the home / new-chat composer, which has no thread yet;
 *  its pick is carried onto the thread the first send creates. */
export const NEW_CHAT = '';

/**
 * Resolved chat model per thread (keyed by threadId; NEW_CHAT for the home
 * composer). `useChatModel(threadId)` publishes the resolved model here and the
 * chat transport reads it back by threadId at send time — so every thread sends
 * its own model, including a background thread that resumes while another is open.
 */
type ModelStore = {
  byThread: Record<string, SelectedModel>;
  setForThread: (threadId: string, model: SelectedModel) => void;
  clear: (threadId: string) => void;
};

export const useModelStore = create<ModelStore>((set) => ({
  byThread: {},
  setForThread: (threadId, model) =>
    set((s) => ({ byThread: { ...s.byThread, [threadId]: model } })),
  clear: (threadId) =>
    set((s) => {
      if (!(threadId in s.byThread)) return s;
      const { [threadId]: _drop, ...rest } = s.byThread;
      return { byThread: rest };
    }),
}));
