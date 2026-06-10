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

// Best-guess initial language from the system locale. The persisted preference
// (which may differ) is applied on mount via useLanguage, correcting this.
const guess = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: guess,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // No Suspense boundary wraps the app, so a live changeLanguage must re-render
  // synchronously rather than suspend — otherwise the switch only shows on reload.
  react: { useSuspense: false },
});

export default i18n;
