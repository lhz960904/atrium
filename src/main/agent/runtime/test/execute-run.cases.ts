// Invoked by runtime.test.ts in an isolated Electron host stub.
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { cleanupRuntime, deferred, runtimeFixture } from './runtime-fixture';

afterEach(cleanupRuntime);

const { executeRun } = await import('../execute-run');
const { findThreadSession, openThreadSession, threadMessages } = await import(
  '@main/conversation/threads'
);
const { LocalSandbox } = await import('../../sandbox');
const computer = await import('@main/platform/computer-use');
const tools = await import('../../tools/registry');
const title = await import('@main/conversation/title');

type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
async function run(f: Fixture, overrides: Partial<Parameters<typeof executeRun>[0]> = {}) {
  const events: import('@shared/protocol').AgentSessionEvent[] = [];
  const result = await executeRun({
    input: f.request,
    runId: 'r1',
    model: f.model,
    db: f.db,
    projectlessRoot: f.dir,
    bgShells: f.bgShells,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    ...overrides,
  });
  const session = await findThreadSession(f.db, 't1');
  const records = (await session?.findRecords({ order: 'oldestFirst' })) ?? [];
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

test('owns begin, message persistence and end; the wire carries deltas and a final event', async () => {
  const f = await runtimeFixture();
  const { result, events, records } = await run(f);
  expect(result).toEqual({ runId: 'r1', status: 'completed', messageId: 'r1' });
  expect(records.filter((r) => r.type === 'operation_started')).toHaveLength(1);
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({
    outcome: 'completed',
  });
  const messages = await threadMessages(f.db, 't1');
  expect(messages.map((message) => message.id)).toEqual(['u1', 'r1']);
  expect(events.find((event) => event.type === 'message_start')).toMatchObject({ messageId: 'r1' });
  expect(events.at(-1)?.type).toBe('agent_end');
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
  expect(
    events.findLast((event) => event.type === 'notice' && event.name === 'message-metadata'),
  ).toMatchObject({
    payload: {
      inputTokens: recorded.usage.input,
      outputTokens: recorded.usage.output,
      totalTokens: recorded.usage.totalTokens,
    },
  });
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
  expect(events.at(-1)?.type).toBe('agent_end');
});

test('context loading failure also closes the recording', async () => {
  const f = await runtimeFixture();
  f.blocks.mockRejectedValue(new Error('context unavailable'));
  const { result, session } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'context unavailable' });
  expect(await session?.findOpenOperations('main')).toEqual([]);
});

test('a prompt write failure closes the operation that begin already opened', async () => {
  const f = await runtimeFixture();
  const session = await openThreadSession(f.db, 't1', f.dir);
  spyOn(f.repo, 'open').mockResolvedValue(session);
  spyOn(session, 'appendEntry').mockRejectedValueOnce(new Error('prompt write failed'));
  const { result, records } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'prompt write failed' });
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'failed',
  });
  expect(await session.findOpenOperations('main')).toEqual([]);
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
  expect(events.at(-1)?.type).toBe('agent_end');
});

test('waiting keeps the operation open and suppresses the artificial blocked tool result', async () => {
  const f = await runtimeFixture();
  f.faux.setResponses([question()]);
  const { result, events, session } = await run(f);
  expect(result.status).toBe('waiting');
  expect(await session?.findOpenOperations('main')).toHaveLength(1);
  expect(events.some((event) => event.type === 'tool_execution_end')).toBe(false);
  const entries = await session?.findEntriesOnBranch();
  expect(
    entries?.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'),
  ).toBe(false);
  expect(events.at(-1)?.type).toBe('agent_end');
});

test('resume stores the answer before invoking pi and extends the original run', async () => {
  const f = await runtimeFixture();
  f.faux.setResponses([question()]);
  const first = await run(f);
  const started = first.records.find((r) => r.type === 'operation_started');
  f.faux.setResponses([
    (context) => {
      const results = context.messages.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ toolCallId: 'call-1', isError: false });
      return fauxAssistantMessage('Understood');
    },
  ]);
  const resumed = await run(f, {
    input: {
      threadId: 't1',
      resumeRunId: 'r1',
      resolutions: [{ toolCallId: 'call-1', kind: 'answered', output: 'A' }],
    },
  });
  expect(resumed.result.status).toBe('completed');
  expect(resumed.records.filter((r) => r.type === 'operation_started')).toHaveLength(1);
  expect(await resumed.session?.findOpenOperations('main')).toEqual([]);
  expect(
    resumed.events.find((event) => event.type === 'notice' && event.name === 'message-metadata'),
  ).toMatchObject({ payload: { createdAt: started?.timestamp } });
});

test('default permissions park a boundary crossing without executing it', async () => {
  const f = await runtimeFixture();
  const exec = spyOn(LocalSandbox.prototype, 'exec').mockResolvedValue({
    output: 'ran',
    exitCode: 0,
  });
  f.faux.setResponses([bash()]);
  const { result, events } = await run(f);
  expect(result.status).toBe('waiting');
  expect(events.find((event) => event.type === 'approval_requested')).toMatchObject({
    toolCallId: 'call-1',
  });
  expect(exec).not.toHaveBeenCalled();
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
  expect(events.some((event) => event.type === 'approval_requested')).toBe(false);
});

test('abort during preparation closes the run and never starts pi', async () => {
  const f = await runtimeFixture();
  const abort = new AbortController();
  f.blocks.mockImplementation(async () => {
    abort.abort();
    return [];
  });
  const { result, session, events } = await run(f, { signal: abort.signal });
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(f.faux.state.callCount).toBe(0);
  expect(await session?.findOpenOperations('main')).toEqual([]);
  expect(events.at(-1)?.type).toBe('agent_end');
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
    signal: abort.signal,
    input: { ...f.request, permissionMode: 'full-access' },
  });
  await entered.promise;
  abort.abort();
  const { result, session, events, records } = await running;
  expect(result.status).toBe('aborted');
  expect(result.error).toBeUndefined();
  expect(await session?.findOpenOperations('main')).toEqual([]);
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    outcome: 'aborted',
  });
  const entries = await session?.findEntriesOnBranch();
  expect(
    entries?.some((entry) => entry.type === 'message' && entry.message.role === 'toolResult'),
  ).toBe(true);
  expect(events.at(-1)?.type).toBe('agent_end');
});

test('a recording close failure is reported but does not prevent the final event', async () => {
  const f = await runtimeFixture();
  const session = await openThreadSession(f.db, 't1', f.dir);
  spyOn(f.repo, 'open').mockResolvedValue(session);
  const append = session.appendRecord.bind(session);
  spyOn(session, 'appendRecord').mockImplementation((record) => {
    if (record.type === 'operation_finished') throw new Error('close write failed');
    return append(record);
  });
  const { result, events } = await run(f);
  expect(result).toMatchObject({ status: 'failed', error: 'close write failed' });
  expect(events.at(-1)?.type).toBe('agent_end');
  // The database could not record completion; leave evidence for recovery.
  expect(await session.findOpenOperations('main')).toHaveLength(1);
});

test('an already-aborted execution opens no session', async () => {
  const f = await runtimeFixture();
  const { result, session } = await run(f, { signal: AbortSignal.abort() });
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
  expect(records.find((r) => r.type === 'operation_finished')).toMatchObject({ outcome: 'failed' });
  expect(events.at(-1)?.type).toBe('agent_end');
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
    expect(await session?.findOpenOperations('main')).toEqual([]);
  },
);

test('a late title is saved without emitting after agent_end', async () => {
  const f = await runtimeFixture();
  f.config['general.autoGenerateTitle'] = true;
  const ready = deferred<Parameters<typeof title.generateThreadTitle>[0]>();
  spyOn(title, 'generateThreadTitle').mockImplementation((opts) => ready.resolve(opts));
  const { events } = await run(f);
  const count = events.length;
  (await ready.promise).onTitle('Late title');
  expect(f.raw.query('SELECT title FROM threads').get()).toEqual({ title: 'Late title' });
  expect(events).toHaveLength(count);
  expect(events.at(-1)?.type).toBe('agent_end');
});
