import { create } from 'zustand';
import type { Attachment } from '../components/chat/composer/AttachmentChip';

/** A one-shot draft (text + attachments) carried from the home composer into a
 *  freshly created thread; the chat view consumes + clears it on mount and
 *  auto-sends it. */
export type PendingDraft = { text: string; attachments: Attachment[] };

type PendingInputStore = {
  draft: PendingDraft | null;
  set: (draft: PendingDraft) => void;
  consume: () => PendingDraft | null;
};

export const usePendingInput = create<PendingInputStore>((set, get) => ({
  draft: null,
  set: (draft) => set({ draft }),
  consume: () => {
    const { draft } = get();
    if (draft !== null) set({ draft: null });
    return draft;
  },
}));
