import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 260;

const clampWidth = (w: number): number =>
  Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w));

type SidebarStore = {
  collapsed: boolean;
  width: number;
  toggle: () => void;
  setWidth: (w: number) => void;
};

/** Sidebar open/collapsed + width, persisted so both survive a reload/restart. */
export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      collapsed: false,
      width: DEFAULT_SIDEBAR_WIDTH,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setWidth: (w) => set({ width: clampWidth(w) }),
    }),
    { name: 'atrium-sidebar' },
  ),
);
