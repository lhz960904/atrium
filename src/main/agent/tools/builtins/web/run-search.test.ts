import { expect, test } from 'bun:test';
import { DDG } from './engines';
import { runSearch } from './run-search';

// The full browser flow needs Electron (unavailable here), but the abort entry
// guard runs before any window is opened, so it's exercisable under bun: an
// already-aborted signal must reject fast rather than reach the BrowserWindow.
test('runSearch rejects immediately for an already-aborted signal, opening no window', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(runSearch(DDG, 'anything', controller.signal)).rejects.toThrow(/abort/i);
});
