import { beforeEach, expect, test } from 'bun:test';
import { DEFAULT_PERMISSION_MODE } from '@shared/permissions';
import { usePermissionStore } from './permission-store';

const reset = (): void =>
  usePermissionStore.setState({ mode: DEFAULT_PERMISSION_MODE, hydrated: false });

beforeEach(reset);

test('starts at the default mode, unhydrated', () => {
  const s = usePermissionStore.getState();
  expect(s.mode).toBe('default');
  expect(s.hydrated).toBe(false);
});

test('hydrate seeds the mode while unhydrated', () => {
  usePermissionStore.getState().hydrate('full-access');
  const s = usePermissionStore.getState();
  expect(s.mode).toBe('full-access');
  expect(s.hydrated).toBe(true);
});

test('hydrate is a no-op once hydrated — a stale value cannot clobber', () => {
  usePermissionStore.getState().hydrate('full-access');
  usePermissionStore.getState().hydrate('auto-review');
  expect(usePermissionStore.getState().mode).toBe('full-access');
});

test('setMode marks the store hydrated', () => {
  usePermissionStore.getState().setMode('auto-review');
  const s = usePermissionStore.getState();
  expect(s.mode).toBe('auto-review');
  expect(s.hydrated).toBe(true);
});

test('a remounted hook re-hydrating cannot revert the user choice', () => {
  // What the bug was: user picks a mode, then a fresh picker mounts and tries to
  // re-seed from a stale persisted value.
  usePermissionStore.getState().setMode('full-access');
  usePermissionStore.getState().hydrate('default'); // stale persisted cache
  expect(usePermissionStore.getState().mode).toBe('full-access');
});
