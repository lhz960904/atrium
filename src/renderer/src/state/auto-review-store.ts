import { create } from 'zustand';

export type AutoReviewToast = { id: string; subject: string };

/**
 * Auto-review approvals this session. `ids` (by toolCallId, global since
 * toolCallIds are unique) drive the persistent shield badge on each reviewed
 * tool marker. `toasts` (by threadId) drive the one-shot notice above the
 * composer, shown and dismissed per thread so a background thread's review
 * never surfaces on the open one. Fed by the Chat's onData handler from
 * transient `data-autoReview` events; all of it is lost on reload (the call's
 * result persists, this is just an in-session hint that the crossing was
 * reviewed rather than slipped through).
 */
type AutoReviewState = {
  ids: ReadonlySet<string>;
  toasts: Record<string, AutoReviewToast[]>;
  mark: (threadId: string, toolCallId: string, subject: string) => void;
  dismissToast: (threadId: string, toolCallId: string) => void;
};

export const useAutoReviewStore = create<AutoReviewState>((set) => ({
  ids: new Set(),
  toasts: {},
  mark: (threadId, toolCallId, subject) =>
    set((s) => ({
      ids: new Set(s.ids).add(toolCallId),
      toasts: {
        ...s.toasts,
        [threadId]: [...(s.toasts[threadId] ?? []), { id: toolCallId, subject }],
      },
    })),
  dismissToast: (threadId, toolCallId) =>
    set((s) => ({
      toasts: {
        ...s.toasts,
        [threadId]: (s.toasts[threadId] ?? []).filter((t) => t.id !== toolCallId),
      },
    })),
}));
