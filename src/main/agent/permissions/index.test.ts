import { expect, test } from 'bun:test';
import { needsApprovalFor } from './index';

const ROOT = '/work/space';

test('full-access never needs approval', () => {
  expect(needsApprovalFor('bash', { command: 'rm -rf /' }, 'full-access', ROOT)).toBe(false);
  expect(needsApprovalFor('write_file', { path: '/etc/hosts' }, 'full-access', ROOT)).toBe(false);
});

test('default asks only on boundary crossings', () => {
  expect(needsApprovalFor('bash', { command: 'curl https://example.com' }, 'default', ROOT)).toBe(
    true,
  );
  expect(needsApprovalFor('bash', { command: 'rm -rf build' }, 'default', ROOT)).toBe(true);
  expect(needsApprovalFor('bash', { command: 'ls -la' }, 'default', ROOT)).toBe(false);
  expect(needsApprovalFor('write_file', { path: 'src/a.ts' }, 'default', ROOT)).toBe(false);
  expect(needsApprovalFor('write_file', { path: '../secret' }, 'default', ROOT)).toBe(true);
  expect(needsApprovalFor('read_file', { path: '/etc/passwd' }, 'default', ROOT)).toBe(false);
});

test('auto-review mirrors default until the reviewer lands', () => {
  expect(needsApprovalFor('bash', { command: 'npm install lodash' }, 'auto-review', ROOT)).toBe(
    true,
  );
  expect(needsApprovalFor('bash', { command: 'git status' }, 'auto-review', ROOT)).toBe(false);
});
