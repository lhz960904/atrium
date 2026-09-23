import { expect, test } from 'bun:test';
import { type ProviderView, selectedProvider } from './types';

/**
 * A fresh install has no providers — one exists only once the user adds it — so
 * the detail pane has nothing to show, and saying that with `null` is what the
 * pane has to be given a chance to handle. It used to be handed the null and
 * read an id off it.
 */

const provider = (id: string) => ({ id, name: id, enabled: true }) as unknown as ProviderView;

test('nothing added yet selects nothing, rather than a provider that is not there', () => {
  expect(selectedProvider([], null)).toBeNull();
  expect(selectedProvider([], 'anthropic')).toBeNull();
});

test('the picked one wins, and the first stands in when the pick is gone', () => {
  const list = [provider('anthropic'), provider('openai')];
  expect(selectedProvider(list, 'openai')?.id).toBe('openai');
  // Removing the selected provider leaves an id that names nothing.
  expect(selectedProvider(list, 'deleted')?.id).toBe('anthropic');
  expect(selectedProvider(list, null)?.id).toBe('anthropic');
});
