import { expect, test } from 'bun:test';
import { deriveRule, isAllowed, type TrustRule } from './rules';

test('deriveRule reduces a bash crossing to its command prefix', () => {
  expect(deriveRule('bash', { command: 'curl https://example.com' })).toEqual({
    tool: 'bash',
    matcher: 'curl',
  });
  expect(deriveRule('bash', { command: 'npm install lodash' })).toEqual({
    tool: 'bash',
    matcher: 'npm install',
  });
  expect(deriveRule('bash', { command: 'rm -rf build' })).toEqual({ tool: 'bash', matcher: 'rm' });
  // A non-crossing segment alongside one crossing → still a single rule.
  expect(deriveRule('bash', { command: 'cd src && curl https://example.com' })).toEqual({
    tool: 'bash',
    matcher: 'curl',
  });
});

test('deriveRule returns null when it cannot reduce to one rule', () => {
  expect(deriveRule('bash', { command: 'echo $(whoami)' })).toBeNull(); // opaque
  expect(deriveRule('bash', { command: 'env FOO=bar curl x' })).toBeNull(); // wrapper
  expect(deriveRule('bash', { command: 'curl x && rm y' })).toBeNull(); // two distinct crossings
});

test('deriveRule uses the exact path for file writes', () => {
  expect(deriveRule('write_file', { path: '/etc/hosts', content: '' })).toEqual({
    tool: 'write_file',
    matcher: '/etc/hosts',
  });
  expect(deriveRule('edit_file', { path: '~/.ssh/config' })).toEqual({
    tool: 'edit_file',
    matcher: '~/.ssh/config',
  });
});

test('isAllowed covers a bash command only when every crossing is in the list', () => {
  const rules: TrustRule[] = [{ tool: 'bash', matcher: 'curl' }];
  expect(isAllowed(rules, 'bash', { command: 'curl https://example.com' })).toBe(true);
  expect(isAllowed(rules, 'bash', { command: 'cd src && curl x' })).toBe(true);
  expect(isAllowed(rules, 'bash', { command: 'rm -rf x' })).toBe(false);
  // curl is allowed but the rm in the same line is not → still gated.
  expect(isAllowed(rules, 'bash', { command: 'curl x && rm y' })).toBe(false);
  // opaque can never be covered by a prefix rule.
  expect(isAllowed(rules, 'bash', { command: 'echo $(curl x)' })).toBe(false);
});

test('isAllowed matches a trusted file path across write and edit', () => {
  const rules: TrustRule[] = [{ tool: 'write_file', matcher: '/etc/hosts' }];
  expect(isAllowed(rules, 'write_file', { path: '/etc/hosts' })).toBe(true);
  expect(isAllowed(rules, 'edit_file', { path: '/etc/hosts' })).toBe(true);
  expect(isAllowed(rules, 'write_file', { path: '/etc/other' })).toBe(false);
});
