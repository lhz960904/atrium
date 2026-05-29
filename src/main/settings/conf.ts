import { Conf } from 'electron-conf/main';

/**
 * User-level app settings (preferences, UI state, onboarding flags).
 *
 * Kept separate from the SQLite-backed user data store (threads / messages /
 * artifacts / providers): this is for client-side preferences that are
 * "lose-it-and-the-app-still-works" — recreate-from-defaults is acceptable.
 *
 * Adding a field: extend `Settings`, add a `default`, then add it to
 * `schema` so JSON-schema validation catches typos at write time.
 */
export type Settings = {
  hasCompletedWelcome: boolean;
};

export const DEFAULTS: Settings = {
  hasCompletedWelcome: false,
};

const schema = {
  type: 'object',
  properties: {
    hasCompletedWelcome: { type: 'boolean' },
  },
  required: ['hasCompletedWelcome'],
  additionalProperties: false,
} as const;

let _conf: Conf<Settings> | null = null;

export function openSettings(): Conf<Settings> {
  if (_conf) return _conf;
  _conf = new Conf<Settings>({
    name: 'settings',
    defaults: DEFAULTS,
    schema,
  });
  return _conf;
}

export function getSettings(): Conf<Settings> {
  if (!_conf) throw new Error('Settings not initialized — call openSettings() first');
  return _conf;
}
