import { describe, expect, test } from 'bun:test';
import type { AtriumUIMessage } from '@shared/chat';
import type { DecideInteraction, InteractionRequest } from '@shared/interactions';
import type { AgentSessionEvent, AssistantMessage, Content } from '@shared/protocol';
import { getPendingApprovals } from '../../approvals';
import { PiChat } from '../store';
import type { ChatTransport, StreamHandlers } from '../transport';

const usage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const assistant = (content: Content[]): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'p',
  model: 'm',
  usage: usage(),
  stopReason: 'stop',
  timestamp: 0,
});

const open = (runId: string): AgentSessionEvent[] => [
  { type: 'run_started', runId },
  { type: 'agent_start' },
  { type: 'message_start', message: assistant([]) },
];

const close = (content: Content[]): AgentSessionEvent[] => [
  { type: 'message_end', message: assistant(content) },
  { type: 'agent_end' },
  { type: 'run_finished', status: 'completed' },
];

const text = (value: string): AgentSessionEvent[] => [
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  } as AgentSessionEvent,
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: value },
  } as AgentSessionEvent,
];

/**
 * A transport the test drives by hand.
 *
 * The store is written against the port, not a protocol, so a test never has to
 * frame a response — it attaches like the main process would and pushes the
 * envelopes it wants seen. `liveRun` is what a rejoin finds: false means the
 * thread has no run to join, which the main process answers by completing at
 * once rather than by replaying a finished log.
 */
function fakeTransport() {
  const sent: { threadId: string; message: AtriumUIMessage }[] = [];
  const decided: DecideInteraction[] = [];
  const aborted: string[] = [];
  const rejoins: number[] = [];
  const fail: { send?: Error; decide?: Error; abort?: Error } = {};
  let attached: StreamHandlers | null = null;
  let detaches = 0;
  let liveRun = false;
  let seq = 0;

  const listen = (handlers: StreamHandlers) => {
    attached = handlers;
    return () => {
      detaches += 1;
      if (attached === handlers) attached = null;
    };
  };

  const transport: ChatTransport = {
    send: async (input) => {
      sent.push({ threadId: input.threadId, message: input.message });
      if (fail.send) throw fail.send;
      liveRun = true;
    },
    decide: async (input) => {
      decided.push(input.interaction);
      if (fail.decide) throw fail.decide;
    },
    abort: async (threadId) => {
      aborted.push(threadId);
      if (fail.abort) throw fail.abort;
    },
    events: (_input, handlers) => listen(handlers),
    rejoin: (input, handlers) => {
      rejoins.push(input.from);
      if (!liveRun) {
        queueMicrotask(() => handlers.onComplete());
        return () => {};
      }
      return listen(handlers);
    },
  };

  return {
    transport,
    sent,
    decided,
    aborted,
    rejoins,
    fail,
    get detaches() {
      return detaches;
    },
    get attached() {
      return attached !== null;
    },
    setLiveRun: (value: boolean) => {
      liveRun = value;
    },
    push(...events: AgentSessionEvent[]) {
      for (const event of events) attached?.onData({ seq: seq++, event });
    },
    end: () => attached?.onComplete(),
    breaks: (error: unknown) => attached?.onError(error),
  };
}

function makeChat(seedMessages: AtriumUIMessage[] = []) {
  const notices: { name: string; payload: unknown }[] = [];
  const t = fakeTransport();
  const chat = new PiChat({
    threadId: 't1',
    messages: seedMessages,
    transport: t.transport,
    getExtras: () => ({ threadId: 't1', providerId: 'deepseek', modelId: 'chat' }),
    onNotice: (name, payload) => notices.push({ name, payload }),
  });
  return { chat, notices, t };
}

async function untilIdle(chat: PiChat, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (chat.isBusy) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('chat never settled');
    await Bun.sleep(10);
  }
}

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('condition never held');
    await Bun.sleep(5);
  }
}

/** Send, then wait for the store to attach to the run's log. */
async function sending(chat: PiChat, t: ReturnType<typeof fakeTransport>, prompt = 'x') {
  chat.sendMessage({ text: prompt });
  await until(() => t.attached);
}

const partOf = (chat: PiChat, toolCallId: string) =>
  chat
    .getSnapshot()
    .messages.flatMap((message) => message.parts)
    .find((part) => (part as { toolCallId?: string }).toolCallId === toolCallId);

const bashRequest: InteractionRequest = {
  id: 'ap-b1',
  runId: 'a1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: 'b1', name: 'bash', arguments: { command: 'ls' } },
  createdAt: 1,
};

const questionRequest: InteractionRequest = {
  id: 'q-c1',
  runId: 'a1',
  kind: 'clarification',
  toolCall: {
    type: 'toolCall',
    id: 'c1',
    name: 'ask_clarification',
    arguments: { questions: [{ header: 'Q', question: 'Which?', inputType: 'text' }] },
  },
  createdAt: 1,
};

describe('sending', () => {
  test('a send starts a run and folds it into history', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t, '你好');
    t.push(...open('a1'), ...text('回答'), ...close([{ type: 'text', text: '回答' }]));
    t.end();
    await untilIdle(chat);

    const snap = chat.getSnapshot();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ threadId: 't1' });
    expect(t.sent[0].message.role).toBe('user');
    expect(snap.status).toBe('ready');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[1]).toMatchObject({ id: 'a1', role: 'assistant' });
  });

  test('a send the main process refuses surfaces as error status', async () => {
    const { chat, t } = makeChat();
    t.fail.send = new Error('Thread t1 is already running');
    chat.sendMessage({ text: 'x' });
    await untilIdle(chat);
    const snap = chat.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.error?.message).toContain('already running');
    // Nothing was watched, because there was no run to watch.
    expect(t.attached).toBe(false);
  });

  test('notices route out while the message stays clean', async () => {
    const { chat, notices, t } = makeChat();
    await sending(chat, t);
    t.push(
      ...open('a1'),
      { type: 'notice', name: 'title', payload: { data: { title: '新标题' } } },
      ...text('回答'),
      ...close([{ type: 'text', text: '回答' }]),
    );
    t.end();
    await untilIdle(chat);

    expect(notices.some((n) => n.name === 'title')).toBe(true);
    const parts = chat.getSnapshot().messages[1].parts;
    expect(parts.some((p) => (p.type as string).startsWith('data-'))).toBe(false);
  });
});

describe('interactions', () => {
  test('approving while the run streams sends one decision and keeps the same run', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t, 'list files');
    t.push(...open('a1'), { type: 'interaction_requested', request: bashRequest });
    await until(() => getPendingApprovals(chat.getSnapshot().messages).length === 1);
    expect(chat.isBusy).toBe(true);

    await chat.addToolApprovalResponse({ id: bashRequest.id, approved: true });
    expect(t.sent).toHaveLength(1);
    expect(t.decided).toEqual([
      { runId: 'a1', interactionId: bashRequest.id, decision: { kind: 'approved' } },
    ]);
    // A decision wakes the call; it neither starts a run nor re-attaches to one.
    expect(t.rejoins).toEqual([]);
    expect(chat.isBusy).toBe(true);

    t.push(
      { type: 'interaction_resolved', request: bashRequest, outcome: { kind: 'approved' } },
      {
        type: 'tool_execution_end',
        toolCallId: 'b1',
        toolName: 'bash',
        result: { content: [], details: { stdout: 'ok' } },
        isError: false,
      },
      ...close([]),
    );
    t.end();
    await untilIdle(chat);
    expect(partOf(chat, 'b1')).toMatchObject({
      state: 'output-available',
      output: { stdout: 'ok' },
    });
  });

  test('an answer goes back as the answer text for the waiting question', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t, 'ask me');
    t.push(...open('a1'), { type: 'interaction_requested', request: questionRequest });
    await until(() => partOf(chat, 'c1') !== undefined);

    await chat.addToolOutput({
      tool: 'ask_clarification',
      toolCallId: 'c1',
      output: { answers: [{ question: 'Which?', answer: 'A' }] },
    });
    expect(t.decided).toEqual([
      {
        runId: 'a1',
        interactionId: questionRequest.id,
        decision: { kind: 'answered', answers: ['A'] },
      },
    ]);
    t.end();
    await untilIdle(chat);
  });

  test('dismissing a question sends a cancellation, not an empty answer', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t, 'ask me');
    t.push(...open('a1'), { type: 'interaction_requested', request: questionRequest });
    await until(() => partOf(chat, 'c1') !== undefined);

    await chat.addToolOutput({
      tool: 'ask_clarification',
      toolCallId: 'c1',
      output: { answers: [], cancelled: true },
    });
    expect(t.decided[0].decision).toEqual({ kind: 'cancelled' });
    t.end();
    await untilIdle(chat);
  });

  test('a decision the main process refuses leaves the request open to try again', async () => {
    const { chat, t } = makeChat();
    t.fail.decide = new Error('The interaction is no longer active.');
    await sending(chat, t, 'list files');
    t.push(...open('a1'), { type: 'interaction_requested', request: bashRequest });
    await until(() => getPendingApprovals(chat.getSnapshot().messages).length === 1);

    await expect(
      chat.addToolApprovalResponse({ id: bashRequest.id, approved: true }),
    ).rejects.toThrow('no longer active');
    expect(getPendingApprovals(chat.getSnapshot().messages)).toHaveLength(1);
    expect(chat.isBusy).toBe(true);
    t.end();
    await untilIdle(chat);
  });

  test('a card left from a run that is no longer streaming cannot be decided', async () => {
    const paused: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-bash',
          toolCallId: 'b1',
          state: 'approval-requested',
          input: { command: 'ls' },
          approval: { id: 'ap1' },
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    const { chat, t } = makeChat([paused]);
    await expect(chat.addToolApprovalResponse({ id: 'ap1', approved: true })).rejects.toThrow(
      'no longer',
    );
    expect(t.decided).toEqual([]);
  });
});

describe('lifecycle', () => {
  test('resume with nothing running settles back to ready', async () => {
    const { chat, t } = makeChat();
    chat.resume();
    await untilIdle(chat);
    expect(t.rejoins).toEqual([-1]);
    expect(chat.getSnapshot().status).toBe('ready');
    expect(chat.getSnapshot().error).toBeUndefined();
  });

  test('rejoining a run that is gone expires what it was waiting on', async () => {
    const stale: AtriumUIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'Before the crash' },
        {
          type: 'tool-bash',
          toolCallId: 'b1',
          state: 'output-available',
          input: { command: 'ls' },
          output: { stdout: 'ok' },
        } as AtriumUIMessage['parts'][number],
        {
          type: 'tool-bash',
          toolCallId: 'b2',
          state: 'approval-requested',
          input: { command: 'curl x' },
          approval: { id: 'ap1' },
        } as AtriumUIMessage['parts'][number],
        {
          type: 'tool-ask_clarification',
          toolCallId: 'c1',
          state: 'input-available',
          input: { questions: [{ header: 'Q', question: 'Which?', inputType: 'text' }] },
        } as AtriumUIMessage['parts'][number],
      ],
      metadata: { createdAt: 1 },
    };
    const { chat, t } = makeChat([stale]);
    chat.resume();
    await untilIdle(chat);

    const parts = chat.getSnapshot().messages[0].parts;
    // Nothing is waiting on a run that no longer exists.
    expect(getPendingApprovals(chat.getSnapshot().messages)).toEqual([]);
    expect(parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'b2')).toMatchObject({
      state: 'output-error',
    });
    expect(parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1')).toMatchObject({
      state: 'output-error',
    });
    // What the run did finish is untouched.
    expect(parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'b1')).toMatchObject({
      state: 'output-available',
      output: { stdout: 'ok' },
    });
    expect(parts).toContainEqual({ type: 'text', text: 'Before the crash' });
    expect(t.rejoins).toEqual([-1]);
    expect(chat.getSnapshot().status).toBe('ready');
  });

  test('a run still in flight is rejoined and its card stays decidable', async () => {
    const { chat, t } = makeChat();
    t.setLiveRun(true);
    chat.resume();
    await until(() => t.attached);
    t.push(...open('a1'), { type: 'interaction_requested', request: bashRequest });
    await until(() => getPendingApprovals(chat.getSnapshot().messages).length === 1);

    await chat.addToolApprovalResponse({ id: bashRequest.id, approved: true });
    expect(t.decided).toHaveLength(1);
    t.push(...close([]));
    t.end();
    await untilIdle(chat);
    expect(chat.getSnapshot().status).toBe('ready');
  });

  test('stop asks the main process to abort and settles once the run ends', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    t.push(...open('a1'), ...text('写到一半'));
    await until(() => chat.getSnapshot().messages.length === 2);

    const stopping = chat.stop();
    await until(() => t.aborted.length === 1);
    expect(t.aborted).toEqual(['t1']);
    expect(chat.isBusy).toBe(true);

    t.push(
      { type: 'agent_end' },
      { type: 'run_finished', status: 'aborted', reason: 'user_cancelled' },
    );
    t.end();
    await stopping;
    const snap = chat.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.messages[1].parts.at(-1)).toMatchObject({ type: 'text', text: '写到一半' });
  });

  test('a stop the main process does not accept leaves the run going', async () => {
    const { chat, t } = makeChat();
    t.fail.abort = new Error('abort failed');
    await sending(chat, t);
    t.push(...open('a1'), ...text('写到一半'));
    await until(() => chat.getSnapshot().messages.length === 2);

    await expect(chat.stop()).rejects.toThrow('abort failed');
    expect(chat.isBusy).toBe(true);
    t.end();
    await untilIdle(chat);
  });

  test('a log that ends before the run finishes is not reported as success', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    t.push(...open('a1'), ...text('半句'));
    await until(() => chat.getSnapshot().messages.length === 2);

    // The log closed without the run saying it finished: the turn went away
    // mid-flight, so what arrived is kept but nothing claims it completed.
    t.end();
    await untilIdle(chat);
    const snap = chat.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.messages[1].parts.at(-1)).toMatchObject({ type: 'text', text: '半句' });
  });

  test('a broken stream is a failure, and detaches', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    t.push(...open('a1'), ...text('写到一半'));
    await until(() => chat.getSnapshot().messages.length === 2);

    t.breaks(new Error('ipc closed'));
    await untilIdle(chat);
    expect(chat.getSnapshot().status).toBe('error');
    expect(t.attached).toBe(false);
  });

  test('a second send supersedes the first watch by detaching it, never by aborting', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    t.push(...open('a1'), ...close([]));
    t.end();
    await untilIdle(chat);
    const detachedOnce = t.detaches;

    await sending(chat, t, 'again');
    t.push(...open('a2'), ...close([]));
    t.end();
    await untilIdle(chat);

    // Detaching is how a watch ends; stopping a turn is only ever `stop`.
    expect(t.detaches).toBeGreaterThan(detachedOnce);
    expect(t.aborted).toEqual([]);
  });

  test('a run that fails before saying anything leaves no message behind', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    // The turn opened and then the provider refused it: a step marker, nothing
    // else. An empty assistant row still takes space and reports "0 tokens",
    // so the error stands on its own instead.
    t.push(...open('a1'), {
      type: 'run_finished',
      status: 'failed',
      error: 'Provider is not configured: deepseek',
    } as AgentSessionEvent);
    t.end();
    await untilIdle(chat);

    const snap = chat.getSnapshot();
    expect(snap.messages.map((message) => message.role)).toEqual(['user']);
    expect(snap.error?.message).toContain('not configured');
  });

  test('setMessages materializes and replaces the list', async () => {
    const { chat, t } = makeChat();
    await sending(chat, t);
    t.push(...open('a1'), ...close([{ type: 'text', text: 'ok' }]));
    t.end();
    await untilIdle(chat);

    chat.setMessages((prev) => prev.slice(0, 1));
    expect(chat.getSnapshot().messages).toHaveLength(1);
    chat.setMessages([]);
    expect(chat.getSnapshot().messages).toHaveLength(0);
  });
});
