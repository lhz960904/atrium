// Invoked by runtime.test.ts in an isolated Electron host stub.
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@shared/protocol';
import { PendingInteractions } from '../pending-interactions';
import { cleanupRuntime, deferred, runtimeFixture } from './runtime-fixture';

afterEach(cleanupRuntime);

const { executeRun } = await import('../execute-run');
const { conversations, ThreadSession } = await import('@main/conversation/store/session');
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
  const session = await conversations().forThread('t1');
  const records = (await session?.records()) ?? [];
  return { events, result, session, records };
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
  const messages = await conversations().getUIMessagesByThreadID('t1');
  expect(messages.map((message) => message.id)).toEqual(['u1', 'r1']);
  expect(events[0]).toEqual({ type: 'run_started', runId: 'r1' });
  expect(events.some((event) => 'messageId' in event)).toBe(false);
  expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
  expect(events.at(-1)).toEqual({ type: 'run_finished', status: 'completed' });
  const updates = events.filter((event) => event.type === 'message_update');
  expect(updates.length).toBeGreaterThan(0);
  for (const event of updates) expect(event.assistantMessageEvent).not.toHaveProperty('partial');
});

test('records usage once using the model identity', async () => {
  const f = await runtimeFixture();
  const response = fauxAssistantMessage('done');
  response.usage = { ...response.usage, input: 3, output: 2, totalTokens: 5 };
  f.faux.setResponses([response]);
  const { events, records } = await run(f);
  const recorded = records.find((record) => record.type === 'usage');
  if (recorded?.type !== 'usage') throw new Error('Missing session usage');
  // Faux derives tokens from the actual request, including the assembled tools.
  expect(recorded.usage.totalTokens).toBeGreaterThan(0);
  expect(f.raw.query('SELECT * FROM usage').all()).toMatchObject([
    {
      message_id: 'r1',
      provider_id: f.model.provider,
      model_id: f.model.id,
      input_tokens: recorded.usage.input,
      output_tokens: recorded.usage.output,
      total_tokens: recorded.usage.totalTokens,
    },
  ]);
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
  const { result, session } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'context unavailable' });
  expect(await session?.openRuns()).toEqual([]);
});

test('a prompt write failure closes the operation that begin already opened', async () => {
  const f = await runtimeFixture();
  spyOn(ThreadSession.prototype, 'appendPrompt').mockRejectedValueOnce(
    new Error('prompt write failed'),
  );
  const { result, records, session } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'prompt write failed' });
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'failed',
  });
  expect(await session?.openRuns()).toEqual([]);
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
  const { result, records, session, events } = await run(f, {
    onEvent: decide({ kind: 'answered', answers: ['A'] }),
  });
  expect(result).toMatchObject({ status: 'completed', messageId: 'r1' });
  expect(records.filter((record) => record.type === 'operation_started')).toHaveLength(1);
  expect(records.filter((record) => record.type === 'operation_finished')).toHaveLength(1);
  const entries = (await session?.entries()) ?? [];
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
  const { result, events, records, session } = await run(f, {
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
  expect(await session?.openRuns()).toEqual([]);
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
  spyOn(ThreadSession.prototype, 'recordInteractionResolved').mockRejectedValue(
    new Error('interaction write failed'),
  );
  f.faux.setResponses([bash(), fauxAssistantMessage('should never be asked')]);
  const { result } = await run(f, { onEvent: decide({ kind: 'approved' }) });
  expect(result).toMatchObject({ status: 'failed', error: 'interaction write failed' });
  expect(exec).not.toHaveBeenCalled();
  expect(f.faux.state.callCount).toBe(1);
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
  const { result, session, events } = await run(f, { abort });
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(f.faux.state.callCount).toBe(0);
  expect(await session?.openRuns()).toEqual([]);
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
  const { result, session, events, records } = await running;
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(await session?.openRuns()).toEqual([]);
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'aborted',
  });
  const entries = await session?.entries();
  expect(
    entries?.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'),
  ).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'aborted' });
});

test('a recording close failure is reported but does not prevent the final event', async () => {
  const f = await runtimeFixture();
  spyOn(ThreadSession.prototype, 'finishRun').mockRejectedValue(new Error('close write failed'));
  const { result, events, session } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'close write failed' });
  // The loop finished; only the app's own settlement failed.
  expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ type: 'run_finished', status: 'failed' });
  // The database could not record completion; leave evidence for recovery.
  expect(await session?.openRuns()).toHaveLength(1);
});

test('an already-aborted execution opens no session', async () => {
  const f = await runtimeFixture();
  const abort = new AbortController();
  abort.abort();
  const { result, session } = await run(f, { abort });
  expect(result.status).toBe('aborted');
  expect(session).toBeUndefined();
});

test('bookkeeping failure still ends the recording and stream', async () => {
  const f = await runtimeFixture();
  f.raw.exec(
    "CREATE TRIGGER fail_usage BEFORE INSERT ON usage BEGIN SELECT RAISE(FAIL, 'usage write failed'); END",
  );
  const response = fauxAssistantMessage('done');
  response.usage = { ...response.usage, input: 1, totalTokens: 1 };
  f.faux.setResponses([response]);
  const { result, records, events } = await run(f);
  expect(result.status).toBe('failed');
  expect(result.error).toContain('usage write failed');
  // The ledger failed, not the turn: the conversation is still recorded as one
  // that finished, while the caller is told the run had a problem.
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({
    outcome: 'completed',
  });
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
    const { result, session } = await run(f);
    expect(result).toMatchObject({ status: 'failed', error: 'context unavailable' });
    expect(hideOverlay).toHaveBeenCalledTimes(1);
    expect(await session?.openRuns()).toEqual([]);
  },
);

test('a late title is saved without emitting after the run finished', async () => {
  const f = await runtimeFixture();
  f.config['general.autoGenerateTitle'] = true;
  const ready = deferred<Parameters<typeof title.generateThreadTitle>[0]>();
  spyOn(title, 'generateThreadTitle').mockImplementation((opts) => ready.resolve(opts));
  const { events } = await run(f);
  const count = events.length;
  (await ready.promise).onTitle('Late title');
  expect(f.raw.query('SELECT title FROM threads').get()).toEqual({ title: 'Late title' });
  expect(events).toHaveLength(count);
  expect(events.at(-1)?.type).toBe('run_finished');
});
