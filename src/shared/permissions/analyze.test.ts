import { expect, test } from 'bun:test';
import { analyzeBash, describeWriteEscape } from './analyze';

test('routine in-workspace commands stay inside', () => {
  expect(analyzeBash('ls -la')).toBeNull();
  expect(analyzeBash('cat src/a.ts | head -n 5')).toBeNull();
  expect(analyzeBash('bun run build')).toBeNull();
  expect(analyzeBash('git status')).toBeNull();
  expect(analyzeBash('mkdir build && cd build')).toBeNull();
  expect(analyzeBash('   ')).toBeNull();
});

test('network commands cross', () => {
  expect(analyzeBash('curl https://example.com')).toMatchObject({ kind: 'network' });
  expect(analyzeBash('npm install lodash')).toMatchObject({ kind: 'network' });
  expect(analyzeBash('git push origin main')).toMatchObject({ kind: 'network' });
  expect(analyzeBash('FOO=bar curl https://example.com')).toMatchObject({ kind: 'network' });
});

test('dangerous commands cross', () => {
  expect(analyzeBash('rm -rf build')).toMatchObject({ kind: 'dangerous' });
  expect(analyzeBash('sudo apt-get update')).toMatchObject({ kind: 'dangerous' });
});

test('substitution and wrappers are opaque', () => {
  expect(analyzeBash('echo $(whoami)')).toMatchObject({ kind: 'opaque' });
  expect(analyzeBash('cat `which node`')).toMatchObject({ kind: 'opaque' });
  expect(analyzeBash('env FOO=bar curl https://example.com')).toMatchObject({ kind: 'opaque' });
});

test('a compound command crosses if any segment does', () => {
  expect(analyzeBash('cd src && curl https://example.com')).toMatchObject({ kind: 'network' });
});

test('describeWriteEscape names the path', () => {
  expect(describeWriteEscape('~/.ssh/config')).toEqual({
    kind: 'fs-escape',
    reason: '写入 workspace 外的路径：~/.ssh/config',
  });
});
