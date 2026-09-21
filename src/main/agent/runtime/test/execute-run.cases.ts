// Invoked by runtime.test.ts in an isolated Electron host stub.
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall, type Usage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@shared/protocol';
import { PendingInteractions } from '../pending-interactions';
import { cleanupRuntime, deferred, runtimeFixture } from './runtime-fixture';

afterEach(cleanupRuntime);

const { executeRun } = await import('../execute-run');
const { conversationStore, Conversation } = await import('@main/conversation/store/conversation');
const { INTERACTION_ENTRY } = await import('@main/conversation/project');
const { LocalSandbox } = await import('../../sandbox');
const computer = await import('@main/platform/computer-use');
const tools = await import('../../tools/registry');
const title = await import('@main/conversation/title');

type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
type RunOverrides = Partial<
  Omit<Parameters<typeof executeRun>[0], 'signal' | 'pending' | 'emit'>
> & {
  abort?: AbortController;
  onEvent?: (event: AgentSessionEvent, pending: PendingInteractions) => void;
};

async function run(
  f: Fixture,
  { abort = new AbortController(), onEvent, ...overrides }: RunOverrides = {},
) {
  const events: AgentSessionEvent[] = [];
  const pending = new PendingInteractions({ runId: 'r1', abort });
  const result = await executeRun({
    input: f.request,
    runId: 'r1',
    model: f.model,
    db: f.db,
    defaultProjectRoot: f.dir,
    bgShells: f.bgShells,
    signal: abort.signal,
    pending,
    emit: (event) => {
      events.push(event);
      onEvent?.(event, pending);
    },
    ...overrides,
  });
  const conversation = await conversationStore().forThread('t1');
  const records = (await conversation?.records()) ?? [];
  return { events, result, conversation, records };
}

const question = () =>
  fauxAssistantMessage(
    fauxToolCall(
      'ask_clarification',
      {
        questions: [{ header: 'Choice', question: 'Which one?', inputType: 'text' }],
      },
      { id: 'call-1' },
    ),
    { stopReason: 'toolUse' },
  );
const bash = () =>
  fauxAssistantMessage(
    fauxToolCall(
      'bash',
      { description: 'Fetch a test page', command: 'curl https://example.invalid' },
      { id: 'call-1' },
    ),
    {
      stopReason: 'toolUse',
    },
  );

const usageOf = (totalTokens: number): Usage => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const decide =
  (decision: Parameters<PendingInteractions['respond']>[0]['decision']) =>
  (event: AgentSessionEvent, pending: PendingInteractions) => {
    if (event.type !== 'interaction_requested') return;
    pending.respond({ runId: 'r1', interactionId: event.request.id, decision });
  };

test('owns begin, message persistence and end; the wire carries deltas and a final event', async () => {
  const f = await runtimeFixture();
  const { result, events, records } = await run(f);
  expect(result).toEqual({ runId: 'r1', status: 'completed', messageId: 'r1' });
  expect(records.filter((r) => r.type === 'operation_started')).toHaveLength(1);
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({
    outcome: 'completed',
  });
  const messages = await conversationStore().getUIMessagesByThreadID('t1');
  expect(messages.map((message) => message.id)).toEqual(['u1', 'r1']);
  expect(events[0]).toEqual({ type: 'run_started', runId: 'r1' });
  expect(events.some((event) => 'messageId' in event)).toBe(false);
  expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
  expect(events.at(-1)).toEqual({ type: 'run_finished', status: 'completed' });
  const updates = events.filter((event) => event.type === 'message_update');
  expect(updates.length).toBeGreaterThan(0);
  for (const event of updates) expect(event.assistantMessageEvent).not.toHaveProperty('partial');
});

test('the turn is where its usage is recorded, and the only place', async () => {
  const f = await runtimeFixture();
  const response = fauxAssistantMessage('done');
  response.usage = { ...response.usage, input: 3, output: 2, totalTokens: 5 };
  f.faux.setResponses([response]);
  const { events, records } = await run(f);
  const recorded = records.filter((record) => record.type === 'usage');
  if (recorded[0]?.type !== 'usage') throw new Error('Missing usage record');
  // One per turn, naming the entry it belongs to — which is how a report reads
  // the model off the turn instead of being told it a second time.
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ cause: 'assistant', runId: 'r1' });
  // Faux derives tokens from the actual request, including the assembled tools.
  expect(recorded[0].usage.totalTokens).toBeGreaterThan(0);
  const entries = (await conversationStore().forThread('t1'))?.entries();
  const turn = (await entries)?.find((e) => e.id === (recorded[0] as { entryId: string }).entryId);
  expect(turn?.type === 'message' && turn.message).toMatchObject({
    provider: f.model.provider,
    model: f.model.id,
  });
  // Token counts ride on the turns themselves; the notice carries only what a
  // reader cannot work out from them.
  expect(
    events.findLast((event) => event.type === 'notice' && event.name === 'message-metadata'),
  ).toMatchObject({ payload: { createdAt: expect.any(Number), durationMs: expect.any(Number) } });
});

test('a preparation failure closes the started recording as failed', async () => {
  const f = await runtimeFixture();
  spyOn(tools, 'getTools').mockImplementation(() => {
    throw new Error('tool setup failed');
  });
  const { result, records, events } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'tool setup failed' });
  expect(result.messageId).toBeUndefined();
  expect(f.faux.state.callCount).toBe(0);
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({ outcome: 'failed' });
  // A run that never reached the loop has no engine events, but still ends.
  expect(events.some((event) => event.type === 'agent_start')).toBe(false);
  expect(events.at(-1)).toEqual({
    type: 'run_finished',
    status: 'failed',
    error: 'tool setup failed',
  });
});

test('context loading failure also closes the recording', async () => {
  const f = await runtimeFixture();
  f.blocks.mockRejectedValue(new Error('context unavailable'));
  const { result, conversation } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'context unavailable' });
  expect(await conversation?.openRuns()).toEqual([]);
});

test('a prompt write failure closes the operation that begin already opened', async () => {
  const f = await runtimeFixture();
  spyOn(Conversation.prototype, 'appendPrompt').mockRejectedValueOnce(
    new Error('prompt write failed'),
  );
  const { result, records, conversation } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'prompt write failed' });
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'failed',
  });
  expect(await conversation?.openRuns()).toEqual([]);
});

test('a provider error is a failed result, without inventing a stored assistant id', async () => {
  const f = await runtimeFixture();
  f.faux.setResponses([
    fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Connection error.' }),
  ]);
  const { result, records, events } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'Connection error.' });
  expect(result.messageId).toBeUndefined();
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({ outcome: 'failed' });
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'failed' });
});

test('an answered clarification is the single real result of one operation', async () => {
  const f = await runtimeFixture();
  f.faux.setResponses([question(), fauxAssistantMessage('Understood')]);
  const { result, records, conversation, events } = await run(f, {
    onEvent: decide({ kind: 'answered', answers: ['A'] }),
  });
  expect(result).toMatchObject({ status: 'completed', messageId: 'r1' });
  expect(records.filter((record) => record.type === 'operation_started')).toHaveLength(1);
  expect(records.filter((record) => record.type === 'operation_finished')).toHaveLength(1);
  const entries = (await conversation?.entries()) ?? [];
  const results = entries.filter(
    (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
  );
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    message: {
      toolCallId: 'call-1',
      isError: false,
      details: { answers: [{ question: 'Which one?', answer: 'A' }] },
    },
  });
  expect(
    entries.filter((entry) => entry.type === 'custom' && entry.customType === INTERACTION_ENTRY),
  ).toHaveLength(2);
  expect(events.filter((event) => event.type === 'interaction_resolved')).toHaveLength(1);
});

test('default permissions ask before a boundary crossing and never run it unanswered', async () => {
  const f = await runtimeFixture();
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([bash()]);
  const { result, events, records, conversation } = await run(f, {
    onEvent: (event, pending) => {
      if (event.type === 'interaction_requested') pending.cancel('user_cancelled');
    },
  });
  expect(result.status).toBe('aborted');
  expect(events.find((event) => event.type === 'interaction_requested')).toMatchObject({
    request: { kind: 'approval', toolCall: { id: 'call-1' } },
  });
  expect(events.find((event) => event.type === 'interaction_resolved')).toMatchObject({
    outcome: { kind: 'interrupted', reason: 'user_cancelled' },
  });
  expect(exec).not.toHaveBeenCalled();
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'aborted',
  });
  expect(await conversation?.openRuns()).toEqual([]);
  expect(events.at(-1)).toEqual({
    type: 'run_finished',
    status: 'aborted',
    reason: 'user_cancelled',
  });
});

test('a decision that cannot be recorded stops the run instead of approving it', async () => {
  const f = await runtimeFixture();
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  // Only the settlement fails: the request itself has to land, or the run would
  // stop before the decision it is meant to be unable to record.
  spyOn(Conversation.prototype, 'recordInteractionResolved').mockRejectedValue(
    new Error('interaction write failed'),
  );
  f.faux.setResponses([bash(), fauxAssistantMessage('should never be asked')]);
  const { result } = await run(f, { onEvent: decide({ kind: 'approved' }) });
  expect(result).toMatchObject({ status: 'failed', error: 'interaction write failed' });
  expect(exec).not.toHaveBeenCalled();
  expect(f.faux.state.callCount).toBe(1);
});

test('a denied call is answered and the run carries on', async () => {
  const f = await runtimeFixture();
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([bash(), fauxAssistantMessage('understood, another way then')]);
  const { result, records } = await run(f, {
    onEvent: decide({ kind: 'denied', reason: 'not that one' }),
  });

  // A denial is an answer, not a stop: pi turns it into an error tool result
  // and the loop takes another turn, which is what DENIED_TEXT is worded for.
  // It would end the run instead if anything ever set `terminate`.
  expect(result.status).toBe('completed');
  expect(exec).not.toHaveBeenCalled();
  expect(f.faux.state.callCount).toBe(2);
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'completed',
  });
});

test('full access uses the same permission mode in the prompt and gate', async () => {
  const f = await runtimeFixture();
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([
    (context) => {
      expect(context.systemPrompt).toContain('full-access mode');
      return bash();
    },
    fauxAssistantMessage('done'),
  ]);
  const { result, events } = await run(f, {
    input: { ...f.request, permissionMode: 'full-access' },
  });
  expect(result.status).toBe('completed');
  expect(exec).toHaveBeenCalledTimes(1);
  expect(events.some((event) => event.type === 'interaction_requested')).toBe(false);
});

test('abort during preparation closes the run and never starts pi', async () => {
  const f = await runtimeFixture();
  const abort = new AbortController();
  f.blocks.mockImplementation(async () => {
    abort.abort();
    return [];
  });
  const { result, conversation, events } = await run(f, { abort });
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(f.faux.state.callCount).toBe(0);
  expect(await conversation?.openRuns()).toEqual([]);
  // Cancelled before a reason was set, so the run only knows it was interrupted.
  expect(events.at(-1)).toEqual({ type: 'run_finished', status: 'aborted', reason: 'interrupted' });
});

test('abort during a tool reaches the sandbox and closes the operation after its result lands', async () => {
  const f = await runtimeFixture();
  const abort = new AbortController();
  const entered = deferred();
  spyOn(LocalSandbox.prototype, 'exec').mockImplementation(async (_command, opts) => {
    entered.resolve();
    await new Promise<void>((resolve) =>
      opts?.signal?.addEventListener('abort', () => resolve(), { once: true }),
    );
    return { output: '[aborted]', exitCode: 1 };
  });
  f.faux.setResponses([bash()]);
  const running = run(f, {
    abort,
    input: { ...f.request, permissionMode: 'full-access' },
  });
  await entered.promise;
  abort.abort();
  const { result, conversation, events, records } = await running;
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(await conversation?.openRuns()).toEqual([]);
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'aborted',
  });
  const entries = await conversation?.entries();
  expect(
    entries?.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'),
  ).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'aborted' });
});

test('a recording close failure is reported but does not prevent the final event', async () => {
  const f = await runtimeFixture();
  spyOn(Conversation.prototype, 'finishRun').mockRejectedValue(new Error('close write failed'));
  const { result, events, conversation } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'close write failed' });
  // The loop finished; only the app's own settlement failed.
  expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'failed' });
  // The database could not record completion; leave evidence for recovery.
  expect(await conversation?.openRuns()).toHaveLength(1);
});

test('an already-aborted execution opens no conversation', async () => {
  const f = await runtimeFixture();
  const abort = new AbortController();
  abort.abort();
  const { result, conversation } = await run(f, { abort });
  expect(result.status).toBe('aborted');
  expect(conversation).toBeUndefined();
});

test('a usage record that cannot be written fails the run, and still closes it', async () => {
  const f = await runtimeFixture();
  // The store's own tables are created when a conversation is first opened, so
  // the trigger cannot be installed until after that.
  await conversationStore().openForThread('t1', f.dir);
  f.raw.exec(
    `CREATE TRIGGER fail_usage BEFORE INSERT ON records WHEN new.type = 'usage'
     BEGIN SELECT RAISE(FAIL, 'usage write failed'); END`,
  );
  const response = fauxAssistantMessage('done');
  response.usage = { ...response.usage, input: 1, totalTokens: 1 };
  f.faux.setResponses([response]);
  const { result, records, events } = await run(f);
  expect(result.status).toBe('failed');
  expect(result.error).toContain('usage write failed');
  // What a turn spent is part of the conversation, not a ledger beside it, so a
  // run that could not record it is a run that failed — calling it completed
  // would claim a journal we do not have.
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({
    outcome: 'failed',
  });
  // Closed all the same: an operation left open would block the next run.
  expect(
    await conversationStore()
      .forThread('t1')
      .then((c) => c?.openRuns()),
  ).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'failed' });
});

test.skipIf(process.platform !== 'darwin')(
  'cleanup runs once and cannot replace the original failure',
  async () => {
    const f = await runtimeFixture();
    f.config['computerUse.enabled'] = true;
    const hideOverlay = mock(() => {
      throw new Error('cleanup failed');
    });
    spyOn(computer, 'getComputerUseHelper').mockReturnValue({
      hideOverlay,
    } as unknown as import('@main/platform/computer-use').ComputerUseHelper);
    f.blocks.mockRejectedValue(new Error('context unavailable'));
    const { result, conversation } = await run(f);
    expect(result).toMatchObject({ status: 'failed', error: 'context unavailable' });
    expect(hideOverlay).toHaveBeenCalledTimes(1);
    expect(await conversation?.openRuns()).toEqual([]);
  },
);

test('a late title is saved without emitting after the run finished', async () => {
  const f = await runtimeFixture();
  f.config['general.autoGenerateTitle'] = true;
  const ready = deferred<Parameters<typeof title.generateThreadTitle>[0]>();
  spyOn(title, 'generateThreadTitle').mockImplementation((opts) => ready.resolve(opts));
  const { events } = await run(f);
  const count = events.length;
  (await ready.promise).onTitle('Late title', usageOf(0));
  expect(f.raw.query('SELECT title FROM threads').get()).toEqual({ title: 'Late title' });
  expect(events).toHaveLength(count);
  expect(events.at(-1)?.type).toBe('run_finished');
});

test('a late title records what it spent against the closed run', async () => {
  const f = await runtimeFixture();
  f.config['general.autoGenerateTitle'] = true;
  const ready = deferred<Parameters<typeof title.generateThreadTitle>[0]>();
  spyOn(title, 'generateThreadTitle').mockImplementation((opts) => ready.resolve(opts));
  const { conversation } = await run(f);

  (await ready.promise).onTitle('Late title', usageOf(46));
  // The write is fire-and-forget, so wait for it rather than for the call.
  await Promise.resolve();

  const side = (await conversation?.records())?.filter(
    (record) => record.type === 'usage' && record.cause === 'adjustment',
  );
  expect(side).toHaveLength(1);
  expect(side?.[0]).toMatchObject({
    usage: { totalTokens: 46 },
    details: { kind: 'title', providerId: f.model.provider, modelId: f.model.id, runId: 'r1' },
  });
  // The run was already closed when this landed; it must not reopen it.
  expect(await conversation?.openRuns()).toEqual([]);
});
