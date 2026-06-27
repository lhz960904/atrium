import { expect, test } from 'bun:test';
import { eventToBinding, formatBinding } from './keymap';

const combo = (e: Partial<Parameters<typeof eventToBinding>[0]>): string | null =>
  eventToBinding({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', ...e });

test('folds ⌘ and Ctrl to the same mod binding', () => {
  expect(combo({ metaKey: true, key: 'k' })).toBe('mod+k');
  expect(combo({ ctrlKey: true, key: 'k' })).toBe('mod+k');
});

test('lowercases the key and orders modifiers mod→alt→shift', () => {
  expect(combo({ metaKey: true, shiftKey: true, key: 'K' })).toBe('mod+shift+k');
  expect(combo({ metaKey: true, altKey: true, shiftKey: true, key: 'B' })).toBe('mod+alt+shift+b');
});

test('keeps punctuation keys verbatim', () => {
  expect(combo({ metaKey: true, key: ',' })).toBe('mod+,');
});

test('returns null for bare keys and lone modifiers', () => {
  expect(combo({ key: 'k' })).toBeNull();
  expect(combo({ shiftKey: true, key: 'K' })).toBeNull();
  expect(combo({ metaKey: true, key: 'Meta' })).toBeNull();
  expect(combo({ ctrlKey: true, key: 'Control' })).toBeNull();
});

test('formatBinding maps mod to the platform keycap symbol', () => {
  // macOS: real symbols, no separator, Apple HIG order ⌥⇧⌘.
  expect(formatBinding('mod+k', true)).toBe('⌘K');
  expect(formatBinding('mod+,', true)).toBe('⌘,');
  expect(formatBinding('mod+shift+k', true)).toBe('⇧⌘K');
  expect(formatBinding('mod+alt+shift+b', true)).toBe('⌥⇧⌘B');
  // Windows/Linux: Ctrl/Shift/Alt joined with +.
  expect(formatBinding('mod+k', false)).toBe('Ctrl+K');
  expect(formatBinding('mod+shift+k', false)).toBe('Ctrl+Shift+K');
});

test('formatBinding renders named keys as symbols', () => {
  expect(formatBinding('mod+enter', true)).toBe('⌘↵');
  expect(formatBinding('mod+enter', false)).toBe('Ctrl+Enter');
});
