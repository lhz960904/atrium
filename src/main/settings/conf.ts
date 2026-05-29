import { Conf } from 'electron-conf/main';

/**
 * User-level app settings (preferences, UI state).
 *
 * Kept separate from the SQLite-backed user data store (threads / messages /
 * artifacts / providers): this is for client-side preferences that are
 * "lose-it-and-the-app-still-works" — recreate-from-defaults is acceptable.
 *
 * Adding a field: extend `Settings`, add a `default`, and expose it through
 * a tRPC procedure on demand — we don't pre-emptively ship empty routers.
 */
export type WindowState = {
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
};

export type Settings = {
  windowState?: WindowState;
};

export const DEFAULTS = {
  windowState: { width: 1280, height: 800, maximized: false, fullscreen: false },
} satisfies Required<Settings>;

let _conf: Conf<Settings> | null = null;

export function openSettings(): Conf<Settings> {
  if (_conf) return _conf;
  _conf = new Conf<Settings>({
    name: 'settings',
    defaults: DEFAULTS,
  });
  return _conf;
}

export function getSettings(): Conf<Settings> {
  if (!_conf) throw new Error('Settings not initialized — call openSettings() first');
  return _conf;
}
