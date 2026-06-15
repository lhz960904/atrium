import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { LocalSandbox } from './local';

test('exec returns command output', async () => {
  const sb = new LocalSandbox(tmpdir());
  const { output, exitCode } = await sb.exec('echo hello');
  expect(output.trim()).toBe('hello');
  expect(exitCode).toBe(0);
});

test('exec aborts a long-running command instead of waiting it out', async () => {
  const sb = new LocalSandbox(tmpdir());
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 50);
  const { output } = await sb.exec('sleep 30', { signal: ac.signal });
  // Resolves promptly because the child is killed, not after sleep 30 finishes.
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(output).toContain('[aborted]');
});

test('exec returns immediately when the signal is already aborted', async () => {
  const sb = new LocalSandbox(tmpdir());
  const { output, exitCode } = await sb.exec('echo nope', { signal: AbortSignal.abort() });
  expect(output).toBe('[aborted]');
  expect(exitCode).toBe(1);
});
