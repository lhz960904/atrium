import { expect, test } from 'bun:test';
import type { PullProgress, pullOllamaModel } from './local-service';
import { PullManager } from './pull-manager';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A controllable fake pull: exposes the progress callback and settle hooks. */
function fakePull() {
  let onProgress: ((p: PullProgress) => void) | undefined;
  let resolve: (() => void) | undefined;
  let reject: ((e: Error) => void) | undefined;
  const pull = ((_base, _model, cb) => {
    onProgress = cb;
    return new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  }) as typeof pullOllamaModel;
  return {
    pull,
    progress: (p: PullProgress) => onProgress?.(p),
    succeed: () => resolve?.(),
    fail: (e: Error) => reject?.(e),
  };
}

test('start runs a pull and reports streaming progress', async () => {
  const fake = fakePull();
  const mgr = new PullManager(fake.pull, 20);
  expect(mgr.start('http://x', 'qwen3:4b')).toBe(true);
  expect(mgr.list()[0]).toMatchObject({ model: 'qwen3:4b', status: 'starting', done: false });

  fake.progress({ status: 'downloading', completed: 30, total: 100 });
  expect(mgr.list()[0]).toMatchObject({ status: 'downloading', completed: 30, total: 100 });
});

test('a second start for the same in-flight model is refused', () => {
  const fake = fakePull();
  const mgr = new PullManager(fake.pull, 20);
  expect(mgr.start('http://x', 'qwen3:4b')).toBe(true);
  expect(mgr.start('http://x', 'qwen3:4b')).toBe(false);
});

test('success becomes a terminal entry that lingers, then self-cleans', async () => {
  const fake = fakePull();
  const mgr = new PullManager(fake.pull, 15);
  mgr.start('http://x', 'qwen3:4b');
  fake.succeed();
  await sleep(0);
  expect(mgr.list()[0]).toMatchObject({ status: 'success', done: true });

  await sleep(30);
  expect(mgr.list()).toEqual([]);
});

test('failure carries the error message and a retry is allowed once terminal', async () => {
  const fake = fakePull();
  const mgr = new PullManager(fake.pull, 50);
  mgr.start('http://x', 'nope:1b');
  fake.fail(new Error('manifest not found'));
  await sleep(0);
  expect(mgr.list()[0]).toMatchObject({ status: 'error', done: true, error: 'manifest not found' });

  // Terminal entry no longer blocks a fresh attempt.
  expect(mgr.start('http://x', 'nope:1b')).toBe(true);
});
