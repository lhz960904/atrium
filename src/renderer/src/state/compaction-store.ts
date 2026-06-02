import { create } from 'zustand';

/**
 * Whether a thread is mid-compaction right now, keyed by threadId. Fed by the
 * Chat's onData handler (chat-store) from transient `data-compaction` events,
 * read by the chat view to show a live "compacting…" indicator. Transient by
 * nature — never persisted; cleared on the matching `done` event.
 */
type CompactionState = {
  active: Record<string, boolean>;
  setActive: (threadId: string, active: boolean) => void;
};

export const useCompactionStore = create<CompactionState>((set) => ({
  active: {},
  setActive: (threadId, active) => set((s) => ({ active: { ...s.active, [threadId]: active } })),
}));
