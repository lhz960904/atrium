import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LANG_CACHE_KEY } from '../i18n';
import { useSetting } from './use-setting';

export type LanguagePref = 'system' | 'en' | 'zh';

/** Resolve the stored preference to a concrete locale ('system' → navigator). */
export function resolveLang(pref: LanguagePref): 'en' | 'zh' {
  if (pref !== 'system') return pref;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * Hydrate i18next from the persisted language preference and persist changes —
 * so the UI language survives a reload. Called once at the app root (to apply
 * on load) and by the Settings switcher (to read + change).
 */
export function useLanguage(): { pref: LanguagePref; setLanguage: (p: LanguagePref) => void } {
  const { i18n } = useTranslation();
  const { value: pref, set, isLoading } = useSetting('general.language');

  useEffect(() => {
    if (isLoading) return;
    const lng = resolveLang(pref);
    // Cache synchronously so the next launch seeds i18n with the right language
    // and skips the mount-time changeLanguage (see i18n/index.ts).
    localStorage.setItem(LANG_CACHE_KEY, lng);
    if (i18n.language !== lng) void i18n.changeLanguage(lng);
  }, [isLoading, pref, i18n]);

  const setLanguage = (p: LanguagePref): void => {
    const lng = resolveLang(p);
    localStorage.setItem(LANG_CACHE_KEY, lng);
    void i18n.changeLanguage(lng);
    set(p);
  };

  return { pref, setLanguage };
}
