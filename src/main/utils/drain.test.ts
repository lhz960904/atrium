import { expect, test } from 'bun:test';
import { drainWithin } from './drain';

test('work that finishes in time drains', async () => {
  expect(await drainWithin(Promise.resolve(), 50)).toBe('drained');
});

test('work that overruns its budget times out', async () => {
  expect(await drainWithin(new Promise(() => {}), 10)).toBe('timed_out');
});

test('a failure is still a finish, and is not thrown at the caller', async () => {
  expect(await drainWithin(Promise.reject(new Error('late')), 50)).toBe('drained');
});
