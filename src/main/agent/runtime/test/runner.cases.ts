// Invoked by runtime.test.ts in an isolated Electron host stub.
import { afterEach, expect, spyOn, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { cleanupRuntime, deferred, runtimeFixture } from './runtime-fixture';

afterEach(cleanupRuntime);

const { createRunner } = await import('../runner');
const { LocalSandbox } = await import('../../sandbox');

test('returns a subscribable handle immediately and rejects duplicate runs without replacing it', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const entered = deferred();
  const release = deferred();
  f.blocks.mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return [];
  });
  const first = runner.start(f.request);
  const stream = runner.subscribe('t1', -1);
  expect(stream).not.toBeNull();
  await entered.promise;
  expect(() => runner.start(f.request)).toThrow('already running');
  expect(runner.runningThreadIds()).toEqual(['t1']);
  expect(runner.abort('t1')).toBe(true);
  expect(runner.isRunning('t1')).toBe(true);
  release.resolve();
  expect((await first.settled).status).toBe('ok');
  expect(runner.isRunning('t1')).toBe(false);
  expect(runner.abort('t1')).toBe(false);
  expect(await new Response(stream).text()).toContain('agent_end');
  expect(f.faux.state.callCount).toBe(0);
  runner.dispose();
});

test('a failed execution releases the thread, seals its stream and allows the next run', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.blocks.mockRejectedValueOnce(new Error('context unavailable'));
  const first = runner.start(f.request);
  expect(await first.settled).toMatchObject({
    runId: first.runId,
    status: 'error',
    error: 'context unavailable',
  });
  expect(runner.runningThreadIds()).toEqual([]);
  expect(await new Response(runner.subscribe('t1', -1)).text()).toContain('agent_end');
  const next = runner.start({ ...f.request, userMessage: { ...f.request.userMessage, id: 'u2' } });
  expect(await next.settled).toMatchObject({
    runId: next.runId,
    status: 'ok',
    messageId: next.runId,
  });
  runner.dispose();
});

test('invalid models fail admission synchronously and create no run or stream', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  expect(() => runner.start({ ...f.request, modelId: 'missing' })).toThrow('not registered');
  expect(runner.subscribe('t1', -1)).toBeNull();
  expect(runner.runningThreadIds()).toEqual([]);
  runner.dispose();
});

test('runner instances own independent cancellation and stream state', async () => {
  const f = await runtimeFixture();
  f.addThread('t2');
  const first = createRunner({ db: f.db, projectlessRoot: f.dir });
  const second = createRunner({ db: f.db, projectlessRoot: f.dir });
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  f.blocks.mockImplementation(async () => {
    if (++calls === 2) entered.resolve();
    await release.promise;
    return [];
  });
  const a = first.start(f.request);
  const b = second.start({ ...f.request, threadId: 't2' });
  await entered.promise;
  expect(second.subscribe('t1', -1)).toBeNull();
  first.dispose();
  expect(() => first.start(f.request)).toThrow('disposed');
  release.resolve();
  expect((await a.settled).status).toBe('ok');
  expect((await b.settled).messageId).toBe(b.runId);
  expect(f.faux.state.callCount).toBe(1);
  second.dispose();
});

test('provider failure reaches the public outcome instead of being lost in a void producer', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'offline' })]);
  const handle = runner.start(f.request);
  expect(await handle.settled).toMatchObject({
    runId: handle.runId,
    status: 'error',
    error: 'offline',
  });
  runner.dispose();
});

test('resume filters stale decisions and keeps the run id and public outcome', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        'ask_clarification',
        {
          questions: [{ header: 'Choice', question: 'Which one?', inputType: 'text' }],
        },
        { id: 'call-1' },
      ),
      { stopReason: 'toolUse' },
    ),
  ]);
  const first = runner.start(f.request);
  expect((await first.settled).status).toBe('ok');
  const request = {
    threadId: 't1',
    providerId: f.model.provider,
    modelId: f.model.id,
    runId: first.runId,
  };
  expect(
    await runner.resume({
      ...request,
      decisions: [{ kind: 'answered', toolCallId: 'stale', output: 'A' }],
    }),
  ).toBeNull();
  f.faux.setResponses([fauxAssistantMessage('Understood')]);
  const resumed = await runner.resume({
    ...request,
    decisions: [{ kind: 'answered', toolCallId: 'call-1', output: 'A' }],
  });
  expect(resumed?.runId).toBe(first.runId);
  expect(await resumed?.settled).toMatchObject({ status: 'ok', messageId: first.runId });
  expect(await runner.settle('t1', [{ kind: 'answered', toolCallId: 'call-1', output: 'A' }])).toBe(
    0,
  );
  runner.dispose();
});

test('approving a parked tool executes it once before resuming the model', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'approved output',
    exitCode: 0,
  });
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        'bash',
        {
          description: 'Test approval',
          command: 'curl https://example.invalid',
        },
        { id: 'call-1' },
      ),
      { stopReason: 'toolUse' },
    ),
  ]);
  const first = runner.start(f.request);
  await first.settled;
  expect(exec).not.toHaveBeenCalled();
  f.faux.setResponses([
    (context) => {
      const results = context.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ content: [{ type: 'text', text: 'approved output' }] });
      return fauxAssistantMessage('done');
    },
  ]);
  const request = {
    threadId: 't1',
    providerId: f.model.provider,
    modelId: f.model.id,
    runId: first.runId,
    decisions: [{ kind: 'approved' as const, toolCallId: 'call-1' }],
  };
  const resumed = await runner.resume(request);
  expect((await resumed?.settled)?.status).toBe('ok');
  expect(exec).toHaveBeenCalledTimes(1);
  expect(await runner.resume(request)).toBeNull();
  expect(exec).toHaveBeenCalledTimes(1);
  runner.dispose();
});
