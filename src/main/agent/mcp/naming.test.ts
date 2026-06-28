import { expect, test } from 'bun:test';
import { isMcpToolName, parseMcpToolName } from '@shared/mcp';
import { qualifyToolName, slug } from './naming';

test('slug sanitizes to the provider function-name charset', () => {
  expect(slug('github')).toBe('github');
  expect(slug('my server!')).toBe('my_server');
  expect(slug('do.it')).toBe('do_it');
  expect(slug('weird/tool@v2')).toBe('weird_tool_v2');
  expect(slug('a__b')).toBe('a_b'); // no `__` survives inside a segment
  expect(slug('---')).toBe('x'); // never empty
});

test('qualifyToolName builds the namespaced form and records it', () => {
  const taken = new Set<string>();
  expect(qualifyToolName('github', 'create_issue', taken)).toBe('mcp__github__create_issue');
  expect(taken.has('mcp__github__create_issue')).toBe(true);
});

test('parseToolName round-trips a simple qualified name', () => {
  expect(parseMcpToolName('mcp__github__create_issue')).toEqual({
    server: 'github',
    tool: 'create_issue',
  });
  expect(parseMcpToolName('read_file')).toBeNull();
  expect(parseMcpToolName('mcp__x')).toBeNull(); // missing tool segment
  expect(isMcpToolName('mcp__a__b')).toBe(true);
  expect(isMcpToolName('bash')).toBe(false);
});

test('collisions get a stable hash suffix, not a positional index', () => {
  const taken = new Set<string>();
  const a = qualifyToolName('srv', 'a.b', taken); // slug -> a_b
  const b = qualifyToolName('srv', 'a/b', taken); // slug -> a_b, collides with a
  expect(a).toBe('mcp__srv__a_b');
  expect(b).not.toBe(a);
  expect(b.startsWith('mcp__srv__a_b_')).toBe(true);

  // Rebuilding the same pair in a fresh set yields the same suffix (identity, not order).
  const fresh = new Set<string>();
  qualifyToolName('srv', 'a.b', fresh);
  expect(qualifyToolName('srv', 'a/b', fresh)).toBe(b);
});

test('over-long names are truncated to <= 64 bytes and stay parseable', () => {
  const taken = new Set<string>();
  const name = qualifyToolName('myserver', 'x'.repeat(200), taken);
  expect(name.length).toBeLessThanOrEqual(64);
  expect(isMcpToolName(name)).toBe(true);
  expect(parseMcpToolName(name)?.server).toBe('myserver');
});
