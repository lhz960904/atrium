import { expect, test } from 'bun:test';
import { SETTINGS_DEFAULTS, SettingsPatchSchema } from './settings';

// Guards the bug where zod v4's .partial() kept field defaults, so patching one
// key refilled (and thus overwrote) its siblings on the server merge.
test('patch carries only the provided keys — no default backfill', () => {
  const parsed = SettingsPatchSchema.parse({ general: { language: 'zh' } });
  expect(parsed).toEqual({ general: { language: 'zh' } });
  // defaultModel / autoGenerateTitle must be ABSENT, not defaulted in.
  expect(Object.keys(parsed.general ?? {})).toEqual(['language']);
});

test('patch still validates the values it does carry', () => {
  expect(() => SettingsPatchSchema.parse({ general: { language: 'nope' } })).toThrow();
  expect(() => SettingsPatchSchema.parse({ permissions: { mode: 'bogus' } })).toThrow();
});

test('an empty scope patch stays empty (no fields invented)', () => {
  expect(SettingsPatchSchema.parse({ general: {} })).toEqual({ general: {} });
});

// Sanity: the full schema still backfills defaults (only the PATCH schema strips
// them), so SETTINGS_DEFAULTS stays complete.
test('full defaults remain complete', () => {
  expect(SETTINGS_DEFAULTS.general.autoGenerateTitle).toBe(true);
  expect(SETTINGS_DEFAULTS.general.defaultModel).toBeNull();
});
