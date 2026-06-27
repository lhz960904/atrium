import { z } from 'zod';
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

const generalShape = z.object({
  /** UI language; 'system' follows the OS locale. */
  language: z.enum(['system', 'en', 'zh']).default('system'),
  /** Last-picked chat model; null until the user has any enabled model. */
  selectedModel: selectedModelShape.nullable().default(null),
  /** Summarize a thread's first message into its title. On by default. */
  autoGenerateTitle: z.boolean().default(true),
  /** Show the app's icon in the macOS menu bar. Off by default. */
  showInMenuBar: z.boolean().default(false),
});

const appearanceShape = z.object({
  /** Window geometry, persisted automatically by main — no panel UI of its own. */
  windowState: windowStateShape.default({
    width: 1280,
    height: 800,
    maximized: false,
    fullscreen: false,
  }),
});

const permissionsShape = z.object({
  /** Active tool-permission mode, persisted so a reload doesn't reset it. */
  mode: z.enum(PERMISSION_MODES).default(DEFAULT_PERMISSION_MODE),
  /** "Always allow" trust list, kept across turns. */
  trustRules: z.array(z.custom<TrustRule>()).default([]),
  /** Model that judges boundary crossings in auto-review; null = unconfigured. */
  reviewerModel: selectedModelShape.nullable().default(null),
});

// zod v4's `.default` takes the resolved output (not an input run through the
// schema), so seed each scope's default from its own all-defaults parse.
export const SettingsSchema = z.object({
  general: generalShape.default(generalShape.parse({})),
  appearance: appearanceShape.default(appearanceShape.parse({})),
  permissions: permissionsShape.default(permissionsShape.parse({})),
});

/**
 * A patch must carry ONLY the keys being set. zod v4's `.partial()` keeps each
 * field's `.default`, so parsing `{ language }` would refill `selectedModel`,
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
  permissions: patchShape(permissionsShape).optional(),
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
 * objects (selectedModel, windowState) are read/written whole — they're leaves,
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
