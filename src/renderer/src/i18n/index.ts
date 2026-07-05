import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { zh } from './zh';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}

export const LANG_CACHE_KEY = 'atrium.language';

// The real preference lives in main-process settings and only resolves after an
// async IPC round-trip. If we seeded i18n from navigator.language instead, we'd
// mount in the wrong language (Electron reports the app locale, e.g. en-US, not
// the user's chosen UI language) and then take a full-tree re-render — every
// useTranslation consumer, i.e. the whole sidebar — when the preference lands a
// couple seconds into a busy startup. useLanguage mirrors the resolved language
// into localStorage (synchronous), so subsequent launches start correct and
// skip that changeLanguage entirely. First-ever launch still falls back to the
// locale guess until the preference caches.
const guess = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
const initialLng = localStorage.getItem(LANG_CACHE_KEY) ?? guess;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // No Suspense boundary wraps the app, so a live changeLanguage must re-render
  // synchronously rather than suspend — otherwise the switch only shows on reload.
  react: { useSuspense: false },
});

export default i18n;
