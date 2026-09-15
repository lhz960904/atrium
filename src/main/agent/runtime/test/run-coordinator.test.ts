import { expect, test } from 'bun:test';
import { createRunCoordinator } from '../run-coordinator';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('rejects a second run without replacing the first buffer or abort controller', async () => {
  const coordinator = createRunCoordinator();
  const gate = deferred();
  const controller = new AbortController();
  const first = coordinator.start(
    't1',
    async (events) => {
      events.append({ type: 'agent_start' });
      await gate.promise;
    },
    controller,
  );

  expect(() => coordinator.start('t1', async () => {}, new AbortController())).toThrow(
    'already running',
  );
  expect(coordinator.runningThreadIds()).toEqual(['t1']);
  expect(coordinator.abort('t1')).toBe(true);
  expect(controller.signal.aborted).toBe(true);
  // Aborting is only a request; the thread stays occupied until cleanup finishes.
  expect(coordinator.isRunning('t1')).toBe(true);
  gate.resolve();
  await first;
  const replay = await new Response(coordinator.subscribe('t1', -1)).text();
  expect(replay).toContain('agent_start');
  expect(coordinator.isRunning('t1')).toBe(false);
  expect(coordinator.abort('t1')).toBe(false);
});

test('propagates producer failures, seals the stream, and permits a subsequent run', async () => {
  const coordinator = createRunCoordinator();
  const failed = coordinator.start(
    't1',
    async (events) => {
      events.append({ type: 'agent_start' });
      throw new Error('storage unavailable');
    },
    new AbortController(),
  );
  await expect(failed).rejects.toThrow('storage unavailable');
  expect(coordinator.runningThreadIds()).toEqual([]);
  expect(await new Response(coordinator.subscribe('t1', -1)).text()).toContain('agent_start');
  await coordinator.start('t1', async () => {}, new AbortController());
});

test('coordinators have independent state and disposal aborts only owned runs', async () => {
  const first = createRunCoordinator();
  const second = createRunCoordinator();
  const gate = deferred();
  const a = new AbortController();
  const b = new AbortController();
  const one = first.start('same-thread', async () => gate.promise, a);
  expect(second.subscribe('same-thread', -1)).toBeNull();
  const two = second.start('same-thread', async () => gate.promise, b);
  first.dispose();
  expect(a.signal.aborted).toBe(true);
  expect(b.signal.aborted).toBe(false);
  expect(() => first.start('other', async () => {}, new AbortController())).toThrow('disposed');
  gate.resolve();
  await Promise.all([one, two]);
});
