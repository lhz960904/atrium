import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from './trpc';

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
  const persisted = trpc.settings.language.useQuery();
  const persist = trpc.settings.setLanguage.useMutation();
  const utils = trpc.useUtils();
  const pref: LanguagePref = persisted.data ?? 'system';

  useEffect(() => {
    if (persisted.isLoading) return;
    const lng = resolveLang(pref);
    if (i18n.language !== lng) void i18n.changeLanguage(lng);
  }, [persisted.isLoading, pref, i18n]);

  const setLanguage = (p: LanguagePref): void => {
    void i18n.changeLanguage(resolveLang(p));
    persist.mutate({ language: p }, { onSuccess: () => utils.settings.language.invalidate() });
  };

  return { pref, setLanguage };
}
