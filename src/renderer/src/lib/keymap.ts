/** A keydown's modifier+key subset — the bits we normalize. A real DOM
 *  KeyboardEvent satisfies this, and tests can pass a plain object. */
type ComboEvent = {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
};

function normalizeKey(key: string): string | null {
  // A lone modifier press isn't a command combo.
  if (key === 'Control' || key === 'Meta' || key === 'Shift' || key === 'Alt') return null;
  return key.toLowerCase();
}

/**
 * Canonical binding string for a keydown, or null when it isn't a configurable
 * command combo. ⌘ and Ctrl both fold to 'mod' (matching the composer's send
 * logic), so the same binding fires on every platform. Bare keys return null —
 * only mod-anchored combos are commands today, which keeps the global listener
 * from hijacking normal typing.
 */
export function eventToBinding(e: ComboEvent): string | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  const key = normalizeKey(e.key);
  if (!key) return null;
  const parts = ['mod'];
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

// ---- Display ----------------------------------------------------------------
// 'mod' is an internal storage/matching token; it must never reach the UI. Every
// surface that shows a binding runs it through formatBinding, which maps each
// part to the platform's real keycap symbol.

export const IS_MAC = navigator.userAgent.includes('Macintosh');

type ModName = 'mod' | 'alt' | 'shift';

const MOD_SYMBOLS: Record<'mac' | 'other', Record<ModName, string>> = {
  mac: { mod: '⌘', alt: '⌥', shift: '⇧' },
  other: { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' },
};

// Apple HIG renders modifiers in a fixed order (⌃⌥⇧⌘); we have no standalone ⌃
// (it's folded into mod = ⌘), so ours read ⌥⇧⌘. Other platforms read Ctrl+Alt+Shift.
const MOD_ORDER: Record<'mac' | 'other', ModName[]> = {
  mac: ['alt', 'shift', 'mod'],
  other: ['mod', 'alt', 'shift'],
};

// macOS prefers glyphs (↵ ⎋) where Windows/Linux read clearer as words; arrows
// are universal. Anything unlisted falls back to a capitalized word.
const KEY_LABELS: Record<string, { mac: string; other: string }> = {
  enter: { mac: '↵', other: 'Enter' },
  escape: { mac: '⎋', other: 'Esc' },
  ' ': { mac: 'Space', other: 'Space' },
  arrowup: { mac: '↑', other: '↑' },
  arrowdown: { mac: '↓', other: '↓' },
  arrowleft: { mac: '←', other: '←' },
  arrowright: { mac: '→', other: '→' },
};

function keyLabel(key: string, isMac: boolean): string {
  const named = KEY_LABELS[key];
  if (named) return isMac ? named.mac : named.other;
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}

export type BindingPart = { kind: 'mod' | 'shift' | 'alt' | 'key'; label: string };

/**
 * Structured combo parts in display order, so a renderer can swap individual
 * parts for icons (e.g. ⌘ → <Command/>) instead of rendering a flat string.
 * macOS orders them ⌥⇧⌘ + key; other platforms mod→alt→shift + key.
 */
export function bindingParts(binding: string, isMac: boolean = IS_MAC): BindingPart[] {
  const plat = isMac ? 'mac' : 'other';
  const raw = binding.split('+');
  const key = raw[raw.length - 1];
  const mods = new Set(raw.slice(0, -1));
  const parts: BindingPart[] = MOD_ORDER[plat]
    .filter((m) => mods.has(m))
    .map((m) => ({ kind: m, label: MOD_SYMBOLS[plat][m] }));
  parts.push({ kind: 'key', label: keyLabel(key, isMac) });
  return parts;
}

/**
 * Flat human-readable combo for text contexts (toasts, tooltips): 'mod+shift+k'
 * → '⇧⌘K' on macOS, 'Ctrl+Shift+K' elsewhere. For UI, prefer the <Kbd> component
 * (built on bindingParts) so ⌘ renders as an icon.
 */
export function formatBinding(binding: string, isMac: boolean = IS_MAC): string {
  return bindingParts(binding, isMac)
    .map((p) => p.label)
    .join(isMac ? '' : '+');
}
