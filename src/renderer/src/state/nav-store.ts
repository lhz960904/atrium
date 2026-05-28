import { create } from 'zustand';

/**
 * Remembers the last route visited under `/_app/*` so that Settings'
 * "Back to app" returns the user to their chat (or empty state),
 * not always to `/`.
 *
 * Updated by the `_app` layout on every navigation; read by the
 * Settings layout when rendering the Back link.
 */
type NavStore = {
  lastAppPath: string;
  setLastAppPath: (path: string) => void;
};

export const useNavStore = create<NavStore>((set) => ({
  lastAppPath: '/',
  setLastAppPath: (path) => set({ lastAppPath: path }),
}));
