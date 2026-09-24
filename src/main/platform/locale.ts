import { getSettings } from '@main/settings/conf';
import { app } from 'electron';

/**
 * The language for anything the main process draws itself — a tray menu, a
 * notification. There is no i18n framework here (the renderer owns
 * react-i18next), so each of those keeps its own handful of strings and asks
 * this which set to use: the user's choice, or the OS locale when they leave it
 * on "system" — or when settings are not open yet.
 */
export function uiLang(): 'en' | 'zh' {
  try {
    const pref = getSettings('general.language');
    if (pref === 'en' || pref === 'zh') return pref;
  } catch {
    // settings not open yet — fall through to the OS locale
  }
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
