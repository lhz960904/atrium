import { z } from 'zod';
import { KEYBINDING_COMMANDS } from './keybindings';
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES } from './permissions';
import type { TrustRule } from './permissions/rules';

/**
 * The single source of truth for user-level app settings: one zod schema grouped
 * by scope (mirroring the settings panel's sections), yielding the type, the
 * runtime defaults, and the patch validator at once. Shared between main
 * (electron-conf storage) and renderer (the `useSetting` hook).
 */

const windowStateShape = z.object({
  width: z.number(),
  height: z.number(),
  maximized: z.boolean(),
  fullscreen: z.boolean(),
});

const selectedModelShape = z.object({ providerId: z.string(), modelId: z.string() });

/** Composer key combo that sends a message; the others insert a newline.
 *  'enter' = Enter sends (default); 'mod' = ⌘/Ctrl+Enter sends; 'shift' =
 *  Shift+Enter sends. In the two non-default modes a bare Enter is a newline. */
export const COMPOSER_SEND_KEYS = ['enter', 'mod', 'shift'] as const;
export type ComposerSendKey = (typeof COMPOSER_SEND_KEYS)[number];

/** Discrete global text-size steps. Each maps to a scale multiplier applied to
 *  the whole type scale in the renderer; 'default' is 1× (no change). */
export const UI_FONT_SIZES = ['small', 'default', 'large'] as const;
export type UiFontSize = (typeof UI_FONT_SIZES)[number];

/** Curated Shiki syntax themes offered for code blocks, split by the app's
 *  light/dark mode. Ids must stay in sync with the themes loaded by the
 *  renderer's Shiki highlighter (src/renderer/.../code-highlighter.ts). */
export const CODE_THEMES_LIGHT = [
  'github-light',
  'one-light',
  'vitesse-light',
  'catppuccin-latte',
  'min-light',
  'solarized-light',
  'rose-pine-dawn',
] as const;
export const CODE_THEMES_DARK = [
  'dark-plus',
  'github-dark',
  'one-dark-pro',
  'dracula',
  'nord',
  'vitesse-dark',
  'tokyo-night',
  'catppuccin-mocha',
] as const;
export type CodeThemeLight = (typeof CODE_THEMES_LIGHT)[number];
export type CodeThemeDark = (typeof CODE_THEMES_DARK)[number];

const generalShape = z.object({
  /** UI language; 'system' follows the OS locale. */
  language: z.enum(['system', 'en', 'zh']).default('system'),
  /** Global default chat model — the fallback for any thread that hasn't bound
   *  its own model. null until the user has any enabled model. */
  defaultModel: selectedModelShape.nullable().default(null),
  /** Summarize a thread's first message into its title. On by default. */
  autoGenerateTitle: z.boolean().default(true),
  /** Show the app's icon in the macOS menu bar. Off by default. */
  showInMenuBar: z.boolean().default(false),
  /** Hide the per-session token/context readout in the composer toolbar. */
  composerHideTokenUsage: z.boolean().default(false),
  /** Which key combo sends vs. inserts a newline in the composer. */
  composerSendKey: z.enum(COMPOSER_SEND_KEYS).default('enter'),
});

const appearanceShape = z.object({
  /** Window geometry, persisted automatically by main — no panel UI of its own. */
  windowState: windowStateShape.default({
    width: 1280,
    height: 800,
    maximized: false,
    fullscreen: false,
  }),
  /** Custom app-chrome font family, typed by the user (they install the font
   *  themselves). Empty = OS default stack. Applied with the system stack
   *  appended as fallback, so an unavailable name degrades gracefully. */
  uiFont: z.string().max(200).default(''),
  /** Global text-size step; multiplies the whole type scale so app chrome, chat
   *  text, and code resize together. */
  uiFontSize: z.enum(UI_FONT_SIZES).default('default'),
  /** Shiki syntax theme for code blocks in light mode. */
  codeThemeLight: z.enum(CODE_THEMES_LIGHT).default('github-light'),
  /** Shiki syntax theme for code blocks in dark mode. */
  codeThemeDark: z.enum(CODE_THEMES_DARK).default('dark-plus'),
});

const keyboardShape = z.object({
  /** Per-command binding overrides; only changed commands are stored. A command
   *  absent here uses its DEFAULT_KEYBINDINGS entry. */
  bindings: z.partialRecord(z.enum(KEYBINDING_COMMANDS), z.string()).default({}),
});

const permissionsShape = z.object({
  /** Active tool-permission mode, persisted so a reload doesn't reset it. */
  mode: z.enum(PERMISSION_MODES).default(DEFAULT_PERMISSION_MODE),
  /** "Always allow" trust list, kept across turns. */
  trustRules: z.array(z.custom<TrustRule>()).default([]),
  /** Model that judges boundary crossings in auto-review; null = unconfigured. */
  reviewerModel: selectedModelShape.nullable().default(null),
});

const browserShape = z.object({
  /** Master switch for agent browser control. On by default: public browsing
   *  (the agent's own window, no login) works out of the box; the signed-in
   *  browser still needs the user to connect their Chrome. */
  enabled: z.boolean().default(true),
  /** Whether the user has connected the signed-in browser (the --extension
   *  server). Persisted so the connection is re-provisioned across restarts.
   *  The extension owns the approval; it prompts on connect ("Allow & select"). */
  connected: z.boolean().default(false),
  /** The extension's own auth token, imported from its status page so reconnects
   *  skip the approval dialog. Empty until imported; the extension rejects any
   *  other value, so it can only be the extension's, not a minted one. */
  extensionToken: z.string().default(''),
});

// zod v4's `.default` takes the resolved output (not an input run through the
// schema), so seed each scope's default from its own all-defaults parse.
export const SettingsSchema = z.object({
  general: generalShape.default(generalShape.parse({})),
  appearance: appearanceShape.default(appearanceShape.parse({})),
  keyboard: keyboardShape.default(keyboardShape.parse({})),
  permissions: permissionsShape.default(permissionsShape.parse({})),
  browser: browserShape.default(browserShape.parse({})),
});

/**
 * A patch must carry ONLY the keys being set. zod v4's `.partial()` keeps each
 * field's `.default`, so parsing `{ language }` would refill `defaultModel`,
 * `autoGenerateTitle`, … to their defaults — and the spread in the patch
 * procedure would then overwrite those stored values. Strip the defaults so an
 * omitted field stays absent (undefined) and survives the merge untouched.
 */
function patchShape<T extends z.ZodObject>(obj: T): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(obj.shape)) {
    const f = field as z.ZodType & { removeDefault?: () => z.ZodType };
    shape[key] = typeof f.removeDefault === 'function' ? f.removeDefault() : f;
  }
  return z.object(shape).partial();
}

export const SettingsPatchSchema = z.object({
  general: patchShape(generalShape).optional(),
  appearance: patchShape(appearanceShape).optional(),
  keyboard: patchShape(keyboardShape).optional(),
  permissions: patchShape(permissionsShape).optional(),
  browser: patchShape(browserShape).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
/** Deep-partial: any subset of scopes, each carrying any subset of its keys. */
export type SettingsPatch = { [S in keyof Settings]?: Partial<Settings[S]> };
export type SettingsScope = keyof Settings;
export type WindowState = z.infer<typeof windowStateShape>;
export type SelectedModel = z.infer<typeof selectedModelShape>;

/**
 * Dot-path address for one setting, à la lodash.get: `${scope}.${key}` for a
 * scoped setting, or a bare key for a (future) top-level scalar. A scope's value
 * objects (defaultModel, windowState) are read/written whole — they're leaves,
 * not further-addressable. To allow a genuinely deeper namespace later, recurse
 * the `.${key}` arm; today there's none, so this stops at one level (no risk of
 * minting a path the two-level patch schema can't accept).
 */
export type SettingPath = {
  [S in keyof Settings]: Settings[S] extends Record<string, unknown>
    ? `${S & string}.${keyof Settings[S] & string}`
    : `${S & string}`;
}[keyof Settings];

/** The value type at a given setting path. */
export type SettingValue<P extends SettingPath> = P extends `${infer S}.${infer K}`
  ? S extends keyof Settings
    ? K extends keyof Settings[S]
      ? Settings[S][K]
      : never
    : never
  : P extends keyof Settings
    ? Settings[P]
    : never;

/** All-defaults snapshot — every field carries a `.default`, so parsing `{}`
 *  materializes the complete nested settings object. */
export const SETTINGS_DEFAULTS: Settings = SettingsSchema.parse({});
