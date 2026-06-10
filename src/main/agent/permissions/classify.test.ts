import { expect, test } from 'bun:test';
import { classifyToolCall } from './classify';

const ROOT = '/work/space';

test('read tools and non-write tools never cross', () => {
  expect(classifyToolCall('read_file', { path: '/etc/passwd' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('web_fetch', { url: 'https://example.com' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('web_search', { query: 'x' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('grep', { pattern: 'x' }, ROOT).crosses).toBe(false);
});

test('in-workspace writes stay inside', () => {
  expect(classifyToolCall('write_file', { path: 'src/a.ts', content: '' }, ROOT).crosses).toBe(
    false,
  );
  expect(classifyToolCall('edit_file', { path: '/work/space/src/a.ts' }, ROOT).crosses).toBe(false);
});

test('writes outside the workspace cross as fsEscape', () => {
  expect(
    classifyToolCall('write_file', { path: '../secret.txt', content: '' }, ROOT),
  ).toMatchObject({ crosses: true, code: 'fsEscape' });
  expect(classifyToolCall('edit_file', { path: '/etc/hosts' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'fsEscape',
  });
});

test('routine in-workspace shell stays inside', () => {
  expect(classifyToolCall('bash', { command: 'ls -la' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('bash', { command: 'cat src/a.ts | head -n 5' }, ROOT).crosses).toBe(
    false,
  );
  expect(classifyToolCall('bash', { command: 'bun run build' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('bash', { command: 'git status' }, ROOT).crosses).toBe(false);
  expect(classifyToolCall('bash', { command: 'mkdir build && cd build' }, ROOT).crosses).toBe(
    false,
  );
});

test('network commands cross', () => {
  expect(classifyToolCall('bash', { command: 'curl https://example.com' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'network',
  });
  expect(classifyToolCall('bash', { command: 'npm install lodash' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'network',
  });
  expect(classifyToolCall('bash', { command: 'git push origin main' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'network',
  });
});

test('env-assignment prefix does not hide the real command', () => {
  expect(
    classifyToolCall('bash', { command: 'FOO=bar curl https://example.com' }, ROOT),
  ).toMatchObject({ crosses: true, code: 'network' });
});

test('dangerous commands cross', () => {
  expect(classifyToolCall('bash', { command: 'rm -rf build' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'dangerous',
  });
  expect(classifyToolCall('bash', { command: 'sudo apt-get update' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'dangerous',
  });
});

test('a compound command crosses if any segment does', () => {
  expect(
    classifyToolCall('bash', { command: 'cd src && curl https://example.com' }, ROOT),
  ).toMatchObject({ crosses: true, code: 'network' });
});

test('opaque commands cross (ask to be safe)', () => {
  expect(classifyToolCall('bash', { command: 'echo $(whoami)' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'substitution',
  });
  expect(classifyToolCall('bash', { command: 'cat `which node`' }, ROOT)).toMatchObject({
    crosses: true,
    code: 'substitution',
  });
  expect(
    classifyToolCall('bash', { command: 'env FOO=bar curl https://example.com' }, ROOT),
  ).toMatchObject({ crosses: true, code: 'wrapper' });
});
