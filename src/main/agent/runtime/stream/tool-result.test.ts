import { expect, test } from 'bun:test';
import { withErrorText } from './tool-result';

test('a successful result keeps its details untouched', () => {
  const details = { text: 'ok' };
  expect(withErrorText(details, [{ type: 'text', text: 'ok' }], false)).toBe(details);
});

test('a failure lifts the reason pi put in content', () => {
  expect(withErrorText({}, [{ type: 'text', text: 'File not found: a.ts' }], true)).toEqual({
    errorText: 'File not found: a.ts',
  });
});

test('a failure that already carries errorText is left alone', () => {
  const details = { errorText: 'own message' };
  expect(withErrorText(details, [{ type: 'text', text: 'other' }], true)).toBe(details);
});

test('a failure with nothing to quote still says something', () => {
  expect(withErrorText(undefined, [], true)).toEqual({ errorText: 'Tool failed.' });
});
