import {
  SETTINGS_DEFAULTS,
  type SettingPath,
  type Settings,
  type SettingValue,
} from '@shared/settings';
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

/**
 * No argument: the Conf handle, for writes — `getSettings().set(...)`.
 *
 * A scope (`'permissions'`) or dot-path (`'general.autoGenerateTitle'`): the
 * read value, with per-field schema defaults merged underneath the stored
 * object — so a field added after the object was last written still resolves to
 * its default instead of `undefined` (electron-conf only backfills a missing
 * key, never a missing field). A second argument overrides that default.
 */
export function getSettings(): Conf<Settings>;
export function getSettings<K extends keyof Settings>(scope: K): Settings[K];
export function getSettings<P extends SettingPath>(
  path: P,
  fallback?: SettingValue<P>,
): SettingValue<P>;
export function getSettings(arg?: string, fallback?: unknown): unknown {
  if (!_conf) throw new Error('Settings not initialized — call openSettings() first');
  if (arg === undefined) return _conf;
  const dot = arg.indexOf('.');
  const scope = dot === -1 ? arg : arg.slice(0, dot);
  const store = _conf.store as Record<string, Record<string, unknown> | undefined>;
  const defaults = SETTINGS_DEFAULTS as Record<string, Record<string, unknown>>;
  const merged = { ...defaults[scope], ...store[scope] };
  if (dot === -1) return merged;
  const value = merged[arg.slice(dot + 1)];
  return value ?? fallback;
}
