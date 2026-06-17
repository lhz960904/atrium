import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchProfile, profileInputSchema } from './profile';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'profile-'));
  created.push(d);
  return d;
}

test('target only accepts soul or user', () => {
  expect(profileInputSchema.parse({ command: 'write', target: 'soul' }).target).toBe('soul');
  expect(() => profileInputSchema.parse({ command: 'view', target: 'other' })).toThrow();
});

test('write then view round-trips each target independently', async () => {
  const dir = await tmp();
  await dispatchProfile(dir, { command: 'write', target: 'soul', content: 'I am 小Q.' });
  await dispatchProfile(dir, { command: 'write', target: 'user', content: 'name: 昊泽' });
  expect(await dispatchProfile(dir, { command: 'view', target: 'soul' })).toBe('I am 小Q.');
  expect(await dispatchProfile(dir, { command: 'view', target: 'user' })).toBe('name: 昊泽');
});

test('view a missing profile guides to get-acquainted; write without content throws', async () => {
  const dir = await tmp();
  expect(await dispatchProfile(dir, { command: 'view', target: 'soul' })).toContain(
    'get-acquainted',
  );
  await expect(dispatchProfile(dir, { command: 'write', target: 'user' })).rejects.toThrow(
    'content',
  );
});
