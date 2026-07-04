import type { UiFontSize } from '@shared/settings';
import { useEffect } from 'react';
import { useSetting } from './use-setting';

/** Multiplier each discrete font-size step applies to the whole type scale. */
const FONT_SCALE: Record<UiFontSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
};

/**
 * Mirror the user's appearance prefs onto :root as CSS vars so the whole app —
 * chrome and content, chat and settings — follows them. Mounted once at the
 * router root.
 *
 * The UI font is a user-typed name that may not be installed, so it's prepended
 * onto the base system stack (--font-sans-system) rather than replacing it: an
 * unavailable or misspelled name degrades to the default face instead of an
 * unstyled fallback. The font size drives --ui-scale, which the type-scale
 * tokens multiply through (tokens.css / .atrium-md).
 */
export function useAppearanceVars(): void {
  const { value: uiFont } = useSetting('appearance.uiFont');
  const { value: uiFontSize } = useSetting('appearance.uiFontSize');

  useEffect(() => {
    const root = document.documentElement;
    const name = uiFont.trim();
    if (name) root.style.setProperty('--font-sans', `"${name}", var(--font-sans-system)`);
    else root.style.removeProperty('--font-sans');
  }, [uiFont]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(FONT_SCALE[uiFontSize]));
  }, [uiFontSize]);
}
