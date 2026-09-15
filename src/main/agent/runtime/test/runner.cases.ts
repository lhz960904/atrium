// Invoked by runtime.test.ts in an isolated Electron host stub.
import { afterEach, expect, spyOn, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { InteractionOutcome, InteractionRequest } from '@shared/interactions';
import { InteractionConflict, InvalidInteractionDecision } from '../pending-interactions';
import { cleanupRuntime, deferred, runtimeFixture } from './runtime-fixture';

afterEach(cleanupRuntime);

const { createRunner } = await import('../runner');
const { LocalSandbox } = await import('../../sandbox');
const { threadMessages } = await import('@main/conversation/threads');

type Handle = ReturnType<ReturnType<typeof createRunner>['start']>;

/** The requests a run asks, in order, awaited on the event rather than on time. */
function watch(handle: Handle) {
  const queued: InteractionRequest[] = [];
  const waiting: Array<(request: InteractionRequest) => void> = [];
  const resolved: InteractionOutcome[] = [];
  handle.subscribe((event) => {
    if (event.type === 'interaction_resolved') resolved.push(event.outcome);
    if (event.type !== 'interaction_requested') return;
    const waiter = waiting.shift();
    if (waiter) waiter(event.request);
    else queued.push(event.request);
  });
  const next = () =>
    new Promise<InteractionRequest>((resolve) => {
      const ready = queued.shift();
      if (ready) resolve(ready);
      else waiting.push(resolve);
    });
  return { next, resolved };
}

const bashCall = (id: string) =>
  fauxToolCall(
    'bash',
    { description: 'Fetch a test page', command: 'curl https://example.invalid' },
    { id },
  );

const question = (count = 1) =>
  fauxAssistantMessage(
    fauxToolCall(
      'ask_clarification',
      {
        questions: Array.from({ length: count }, (_, index) => ({
          header: `Q${index}`,
          question: `Which ${index}?`,
          inputType: 'text',
        })),
      },
      { id: 'call-1' },
    ),
    { stopReason: 'toolUse' },
  );

const partFor = (parts: readonly unknown[] | undefined, toolCallId: string) =>
  parts?.find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId);

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

test('approval continues the original run and executes the tool once', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'approved output',
    exitCode: 0,
  });
  f.faux.setResponses([
    fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' }),
    (context) => {
      const results = context.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ content: [{ type: 'text', text: 'approved output' }] });
      return fauxAssistantMessage('done');
    },
  ]);
  const handle = runner.start(f.request);
  const interactions = watch(handle);
  const request = await interactions.next();
  expect(request).toMatchObject({
    runId: handle.runId,
    kind: 'approval',
    toolCall: { id: 'call-1' },
  });
  expect(runner.isRunning('t1')).toBe(true);
  expect(exec).not.toHaveBeenCalled();
  const decision = {
    runId: handle.runId,
    interactionId: request.id,
    decision: { kind: 'approved' as const },
  };
  expect(runner.respond('t1', decision)).toBe('accepted');
  expect(runner.respond('t1', decision)).toBe('already_accepted');
  expect(await handle.settled).toMatchObject({ status: 'ok', messageId: handle.runId });
  expect(exec).toHaveBeenCalledTimes(1);
  expect(interactions.resolved).toEqual([{ kind: 'approved' }]);
  expect(f.faux.state.callCount).toBe(2);
  expect(runner.isRunning('t1')).toBe(false);
  expect(() => runner.respond('t1', decision)).toThrow(InteractionConflict);
  runner.dispose();
});

test('a denial blocks the tool and the model reads the reason', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([
    fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' }),
    (context) => {
      const results = context.messages.filter((message) => message.role === 'toolResult');
      expect(results).toMatchObject([
        { isError: true, content: [{ type: 'text', text: 'Use the cached copy instead.' }] },
      ]);
      return fauxAssistantMessage('Using the cached copy.');
    },
  ]);
  const handle = runner.start(f.request);
  const request = await watch(handle).next();
  runner.respond('t1', {
    runId: handle.runId,
    interactionId: request.id,
    decision: { kind: 'denied', reason: 'Use the cached copy instead.' },
  });
  expect((await handle.settled).status).toBe('ok');
  expect(exec).not.toHaveBeenCalled();
  expect(f.faux.state.callCount).toBe(2);
  const messages = await threadMessages(f.db, 't1');
  expect(partFor(messages.at(-1)?.parts, 'call-1')).toMatchObject({ state: 'output-denied' });
  runner.dispose();
});

test('an answered clarification becomes the tool result of the same run', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([
    question(2),
    (context) => {
      const results = context.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ toolCallId: 'call-1', isError: false });
      return fauxAssistantMessage('Understood');
    },
  ]);
  const handle = runner.start(f.request);
  const request = await watch(handle).next();
  expect(request.kind).toBe('clarification');
  const answer = (answers: string[]) =>
    runner.respond('t1', {
      runId: handle.runId,
      interactionId: request.id,
      decision: { kind: 'answered', answers },
    });
  expect(() => answer(['A'])).toThrow(InvalidInteractionDecision);
  expect(answer(['A', 'B'])).toBe('accepted');
  expect(await handle.settled).toMatchObject({ status: 'ok', messageId: handle.runId });
  expect(f.faux.state.callCount).toBe(2);
  const messages = await threadMessages(f.db, 't1');
  expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(partFor(messages.at(-1)?.parts, 'call-1')).toMatchObject({
    state: 'output-available',
    output: {
      answers: [
        { question: 'Which 0?', answer: 'A' },
        { question: 'Which 1?', answer: 'B' },
      ],
    },
  });
  runner.dispose();
});

test('cancelling a clarification ends the run without asking the model again', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([question(), fauxAssistantMessage('should never be asked')]);
  const handle = runner.start(f.request);
  const request = await watch(handle).next();
  runner.respond('t1', {
    runId: handle.runId,
    interactionId: request.id,
    decision: { kind: 'cancelled' },
  });
  expect((await handle.settled).status).toBe('ok');
  expect(f.faux.state.callCount).toBe(1);
  const messages = await threadMessages(f.db, 't1');
  expect(partFor(messages.at(-1)?.parts, 'call-1')).toMatchObject({
    state: 'output-available',
    output: { answers: [], cancelled: true },
  });
  runner.dispose();
});

test('stopping while a decision is pending settles the run and runs nothing', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' })]);
  const handle = runner.start(f.request);
  const interactions = watch(handle);
  const request = await interactions.next();
  expect(runner.abort('t1')).toBe(true);
  expect((await handle.settled).status).toBe('ok');
  expect(interactions.resolved).toEqual([{ kind: 'interrupted', reason: 'user_cancelled' }]);
  expect(exec).not.toHaveBeenCalled();
  expect(f.faux.state.callCount).toBe(1);
  expect(() =>
    runner.respond('t1', {
      runId: handle.runId,
      interactionId: request.id,
      decision: { kind: 'approved' },
    }),
  ).toThrow(InteractionConflict);
  runner.dispose();
});

test('an approved call waits for the rest of its batch, and a stop runs neither', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([
    fauxAssistantMessage([bashCall('call-1'), bashCall('call-2')], { stopReason: 'toolUse' }),
  ]);
  const handle = runner.start(f.request);
  const interactions = watch(handle);
  const first = await interactions.next();
  runner.respond('t1', {
    runId: handle.runId,
    interactionId: first.id,
    decision: { kind: 'approved' },
  });
  const second = await interactions.next();
  expect(second.toolCall.id).toBe('call-2');
  expect(exec).not.toHaveBeenCalled();
  runner.abort('t1');
  expect((await handle.settled).status).toBe('ok');
  expect(exec).not.toHaveBeenCalled();
  runner.dispose();
});

test('a thread waiting for a decision refuses another run and compaction', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' })]);
  const handle = runner.start(f.request);
  await watch(handle).next();
  expect(() =>
    runner.start({ ...f.request, userMessage: { ...f.request.userMessage, id: 'u2' } }),
  ).toThrow('already running');
  await expect(
    runner.compact({ threadId: 't1', providerId: f.model.provider, modelId: f.model.id }),
  ).rejects.toThrow('already running');
  runner.abort('t1');
  await handle.settled;
  runner.dispose();
});

test('decisions addressed to another run or an idle thread conflict', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' })]);
  const handle = runner.start(f.request);
  const request = await watch(handle).next();
  const approved = { kind: 'approved' as const };
  expect(() =>
    runner.respond('t1', { runId: 'another-run', interactionId: request.id, decision: approved }),
  ).toThrow(InteractionConflict);
  expect(() =>
    runner.respond('t2', { runId: handle.runId, interactionId: request.id, decision: approved }),
  ).toThrow(InteractionConflict);
  expect(runner.isRunning('t1')).toBe(true);
  runner.abort('t1');
  await handle.settled;
  runner.dispose();
});

test('reconnecting while waiting replays the request and starts nothing new', async () => {
  const f = await runtimeFixture();
  const runner = createRunner({ db: f.db, projectlessRoot: f.dir });
  f.faux.setResponses([fauxAssistantMessage(bashCall('call-1'), { stopReason: 'toolUse' })]);
  const handle = runner.start(f.request);
  await watch(handle).next();
  const reader = runner.subscribe('t1', -1)?.getReader();
  const decoder = new TextDecoder();
  let replayed = '';
  while (reader && !replayed.includes('interaction_requested')) {
    const { value, done } = await reader.read();
    if (done) break;
    replayed += decoder.decode(value, { stream: true });
  }
  expect(replayed).toContain('interaction_requested');
  expect(f.faux.state.callCount).toBe(1);
  expect(runner.isRunning('t1')).toBe(true);
  await reader?.cancel();
  runner.abort('t1');
  await handle.settled;
  runner.dispose();
});
