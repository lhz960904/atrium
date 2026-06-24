import { create } from 'zustand';

/**
 * The project a new chat should start in, set by a sidebar project's "new chat"
 * action just before it navigates home. The home composer seeds its picker from
 * it — on mount or live, so it updates even when home is already open — then
 * consumes it. Projectless new-chat entries leave it null.
 */
type PendingProjectStore = {
  projectId: string | null;
  set: (projectId: string) => void;
  consume: () => string | null;
};

export const usePendingProject = create<PendingProjectStore>((set, get) => ({
  projectId: null,
  set: (projectId) => set({ projectId }),
  consume: () => {
    const { projectId } = get();
    if (projectId !== null) set({ projectId: null });
    return projectId;
  },
}));
