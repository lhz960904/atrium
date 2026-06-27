import { SETTINGS_DEFAULTS, type Settings } from '@shared/settings';
import { Conf } from 'electron-conf/main';

/**
 * User-level app settings (preferences, UI state).
 *
 * Kept separate from the SQLite-backed user data store (threads / messages /
 * artifacts / providers): this is for client-side preferences that are
 * "lose-it-and-the-app-still-works" — recreate-from-defaults is acceptable.
 *
 * Shape, defaults, and validation all live in `@shared/settings` so main and
 * renderer agree on one schema. Re-exported here for existing importers.
 */
export type { SelectedModel, Settings, WindowState } from '@shared/settings';

export const DEFAULTS = SETTINGS_DEFAULTS;

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
