import { create } from 'zustand';

/** Open state for the ⌘K command palette — driven by the global hotkey, the
 *  sidebar Search button, and (later) the composer's Search command. */
type CommandPaletteStore = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

export const useCommandPalette = create<CommandPaletteStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
