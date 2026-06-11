import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import type { TrustRule } from '@shared/permissions/rules';
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

/** Last-picked chat model; null until the user has any enabled model. */
export type SelectedModel = { providerId: string; modelId: string };

export type Settings = {
  windowState?: WindowState;
  selectedModel?: SelectedModel | null;
  /** UI language; 'system' follows the OS locale. Persisted so it survives reload. */
  language?: 'system' | 'en' | 'zh';
  /** The active tool-permission mode, persisted so a reload doesn't reset it. */
  permissionMode?: PermissionMode;
  /** The tool-permission trust list — "always allow" entries, kept across turns. */
  trustRules?: TrustRule[];
  /** Model that judges boundary crossings in auto-review mode; null = unconfigured
   *  (auto-review then falls back to prompting). Decoupled from the chat model.
   **/
  reviewerModel?: SelectedModel | null;
};

export const DEFAULTS = {
  windowState: { width: 1280, height: 800, maximized: false, fullscreen: false },
  selectedModel: null,
  language: 'system',
  permissionMode: DEFAULT_PERMISSION_MODE,
  trustRules: [],
  reviewerModel: null,
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
