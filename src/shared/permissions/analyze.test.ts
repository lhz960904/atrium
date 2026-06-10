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
  expect(analyzeBash('curl https://example.com')).toMatchObject({
    code: 'network',
    subject: 'curl',
  });
  expect(analyzeBash('npm install lodash')).toMatchObject({
    code: 'network',
    subject: 'npm install',
  });
  expect(analyzeBash('git push origin main')).toMatchObject({ code: 'network' });
  expect(analyzeBash('FOO=bar curl https://example.com')).toMatchObject({ code: 'network' });
});

test('dangerous commands cross', () => {
  expect(analyzeBash('rm -rf build')).toMatchObject({ code: 'dangerous', subject: 'rm' });
  expect(analyzeBash('sudo apt-get update')).toMatchObject({ code: 'dangerous', subject: 'sudo' });
});

test('substitution / unparseable / wrappers are opaque codes', () => {
  expect(analyzeBash('echo $(whoami)')).toMatchObject({ code: 'substitution' });
  expect(analyzeBash('cat `which node`')).toMatchObject({ code: 'substitution' });
  expect(analyzeBash('env FOO=bar curl https://example.com')).toMatchObject({ code: 'wrapper' });
});

test('a compound command crosses if any segment does', () => {
  expect(analyzeBash('cd src && curl https://example.com')).toMatchObject({ code: 'network' });
});

test('describeWriteEscape names the path', () => {
  expect(describeWriteEscape('~/.ssh/config')).toEqual({
    code: 'fsEscape',
    subject: '~/.ssh/config',
  });
});
