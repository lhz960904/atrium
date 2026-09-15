import { describe, expect, test } from 'bun:test';
import type { AtriumUIMessage } from '@shared/chat';
import type { InteractionRequest } from '@shared/interactions';
import type { AgentSessionEvent, AssistantMessage, Content } from '@shared/protocol';
import { getPendingApprovals } from '../../approvals';
import { PiChat } from '../store';

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

/** The wire as the server writes it: one envelope per line of SSE. */
function sseBody(events: AgentSessionEvent[]): string {
  return events.map((event, seq) => `data: ${JSON.stringify({ v: 1, seq, event })}\n\n`).join('');
}

const open = (messageId: string): AgentSessionEvent[] => [
  { type: 'agent_start' },
  { type: 'message_start', messageId, message: assistant([]) },
];

const close = (messageId: string, content: Content[]): AgentSessionEvent[] => [
  { type: 'message_end', messageId, message: assistant(content) },
  { type: 'agent_end', willRetry: false },
];

const sayText = (messageId: string, value: string): AgentSessionEvent[] => [
  ...open(messageId),
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
  } as AgentSessionEvent,
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: value },
  } as AgentSessionEvent,
  {
    type: 'message_update',
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: value },
  } as AgentSessionEvent,
  ...close(messageId, [{ type: 'text', text: value }]),
];

type Call = { url: string; init?: RequestInit };

function makeChat(
  handler: (url: string, init?: RequestInit) => Response,
  seedMessages: AtriumUIMessage[] = [],
) {
  const calls: Call[] = [];
  const notices: { name: string; payload: unknown }[] = [];
  const chat = new PiChat({
    threadId: 't1',
    baseUrl: 'http://test',
    token: 'tok',
    messages: seedMessages,
    getExtras: () => ({ threadId: 't1', providerId: 'deepseek', modelId: 'chat' }),
    onNotice: (name, payload) => notices.push({ name, payload }),
    fetchFn: ((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(handler(String(url), init));
    }) as typeof fetch,
  });
  return { chat, calls, notices };
}

async function untilIdle(chat: PiChat, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (chat.isBusy) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('chat never settled');
    await Bun.sleep(10);
  }
}

/** A run's SSE body the test keeps open and feeds by hand. */
function liveStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let seq = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push(...events: AgentSessionEvent[]) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ v: 1, seq: seq++, event })}\n\n`),
        );
      }
    },
    close: () => controller.close(),
  };
}

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('condition never held');
    await Bun.sleep(5);
  }
}

const bodyOf = (call: Call) => JSON.parse(String(call.init?.body));

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

/** A chat whose send stays open on `stream`; decisions and stops answer with `answer`. */
function liveChat(
  stream: ReturnType<typeof liveStream>,
  answer = () => Response.json({ status: 'accepted' }, { status: 202 }),
) {
  return makeChat((url) => (url.endsWith('/api/chat') ? new Response(stream.body) : answer()));
}

const textRun = sayText('a1', '回答');

describe('sending', () => {
  test('a send posts on the pi track and folds the run into history', async () => {
    const { chat, calls } = makeChat(() => new Response(sseBody(textRun)));
    chat.sendMessage({ text: '你好' });
    await untilIdle(chat);
    const snap = chat.getSnapshot();
    expect(calls[0].url).toBe('http://test/api/chat');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ threadId: 't1', providerId: 'deepseek' });
    expect(body.message.role).toBe('user');
    expect(snap.status).toBe('ready');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[1]).toMatchObject({ id: 'a1', role: 'assistant' });
    expect(snap.messages[1].parts).toContainEqual({ type: 'text', text: '回答', state: 'done' });
  });

  test('a failed request surfaces as error status', async () => {
    const { chat } = makeChat(() => new Response('boom', { status: 500 }));
    chat.sendMessage({ text: 'x' });
    await untilIdle(chat);
    const snap = chat.getSnapshot();
    expect(snap.status).toBe('error');
    expect(snap.error?.message).toContain('500');
  });

  test('notices route out while the message stays clean', async () => {
    const { chat, notices } = makeChat(
      () =>
        new Response(
          sseBody([
            ...open('a1'),
            { type: 'notice', name: 'title', payload: { data: { title: '新标题' } } },
            ...close('a1', []),
          ]),
        ),
    );
    chat.sendMessage({ text: 'x' });
    await untilIdle(chat);
    expect(notices.some((n) => n.name === 'title')).toBe(true);
    const parts = chat.getSnapshot().messages[1].parts;
    expect(parts.some((p) => (p.type as string).startsWith('data-'))).toBe(false);
  });
});

describe('interactions', () => {
  test('approving while the run streams sends one decision and keeps the same run', async () => {
    const stream = liveStream();
    const { chat, calls } = liveChat(stream);
    chat.sendMessage({ text: 'list files' });
    stream.push(...open('a1'), { type: 'interaction_requested', request: bashRequest });
    await until(() => getPendingApprovals(chat.getSnapshot().messages).length === 1);
    expect(chat.isBusy).toBe(true);

    await chat.addToolApprovalResponse({ id: bashRequest.id, approved: true });
    expect(calls.filter((call) => call.url.endsWith('/api/chat'))).toHaveLength(1);
    const decisions = calls.filter((call) => call.url.endsWith('/decisions'));
    expect(decisions.map((call) => call.url)).toEqual(['http://test/api/chat/t1/decisions']);
    expect(bodyOf(decisions[0])).toEqual({
      runId: 'a1',
      interactionId: bashRequest.id,
      decision: { kind: 'approved' },
    });
    expect(calls.some((call) => call.url.endsWith('/resume'))).toBe(false);
    expect(chat.isBusy).toBe(true);

    stream.push(
      { type: 'interaction_resolved', request: bashRequest, outcome: { kind: 'approved' } },
      {
        type: 'tool_execution_end',
        toolCallId: 'b1',
        toolName: 'bash',
        result: { content: [], details: { stdout: 'ok' } },
        isError: false,
      },
      ...close('a1', []),
    );
    stream.close();
    await untilIdle(chat);
    expect(partOf(chat, 'b1')).toMatchObject({
      state: 'output-available',
      output: { stdout: 'ok' },
    });
  });

  test('an answer goes back as the answer text for the waiting question', async () => {
    const stream = liveStream();
    const { chat, calls } = liveChat(stream);
    chat.sendMessage({ text: 'ask me' });
    stream.push(...open('a1'), { type: 'interaction_requested', request: questionRequest });
    await until(() => partOf(chat, 'c1') !== undefined);
    await chat.addToolOutput({
      tool: 'ask_clarification',
      toolCallId: 'c1',
      output: { answers: [{ question: 'Which?', answer: 'A' }] },
    });
    const [decision] = calls.filter((call) => call.url.endsWith('/decisions'));
    expect(bodyOf(decision)).toEqual({
      runId: 'a1',
      interactionId: questionRequest.id,
      decision: { kind: 'answered', answers: ['A'] },
    });
    stream.close();
    await untilIdle(chat);
  });

  test('dismissing a question sends a cancellation, not an empty answer', async () => {
    const stream = liveStream();
    const { chat, calls } = liveChat(stream);
    chat.sendMessage({ text: 'ask me' });
    stream.push(...open('a1'), { type: 'interaction_requested', request: questionRequest });
    await until(() => partOf(chat, 'c1') !== undefined);
    await chat.addToolOutput({
      tool: 'ask_clarification',
      toolCallId: 'c1',
      output: { answers: [], cancelled: true },
    });
    const [decision] = calls.filter((call) => call.url.endsWith('/decisions'));
    expect(bodyOf(decision).decision).toEqual({ kind: 'cancelled' });
    stream.close();
    await untilIdle(chat);
  });

  test('a decision the server refuses leaves the request open to try again', async () => {
    const stream = liveStream();
    const { chat } = liveChat(stream, () => Response.json({ error: 'conflict' }, { status: 409 }));
    chat.sendMessage({ text: 'list files' });
    stream.push(...open('a1'), { type: 'interaction_requested', request: bashRequest });
    await until(() => getPendingApprovals(chat.getSnapshot().messages).length === 1);
    await expect(
      chat.addToolApprovalResponse({ id: bashRequest.id, approved: true }),
    ).rejects.toThrow('409');
    expect(getPendingApprovals(chat.getSnapshot().messages)).toHaveLength(1);
    expect(chat.isBusy).toBe(true);
    stream.close();
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
    const { chat, calls } = makeChat(() => new Response(null, { status: 500 }), [paused]);
    await expect(chat.addToolApprovalResponse({ id: 'ap1', approved: true })).rejects.toThrow(
      'no longer',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('lifecycle', () => {
  test('resume with nothing running settles back to ready', async () => {
    const { chat, calls } = makeChat(() => new Response(null, { status: 204 }));
    chat.resume();
    await untilIdle(chat);
    expect(calls[0].url).toContain('/api/chat/t1/pi-events?from=-1');
    expect(chat.getSnapshot().status).toBe('ready');
    expect(chat.getSnapshot().error).toBeUndefined();
  });

  test('stop asks the server to abort and settles once the run ends', async () => {
    const stream = liveStream();
    const { chat, calls } = liveChat(stream, () => Response.json({ aborted: true }));
    chat.sendMessage({ text: 'x' });
    stream.push(
      ...open('a1'),
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
      } as AgentSessionEvent,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '写到一半' },
      } as AgentSessionEvent,
    );
    await until(() => chat.getSnapshot().messages.length === 2);
    const stopping = chat.stop();
    await until(() => calls.some((call) => call.url === 'http://test/api/chat/t1/abort'));
    expect(chat.isBusy).toBe(true);
    stream.push({ type: 'agent_end', willRetry: false });
    stream.close();
    await stopping;
    const snap = chat.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.messages[1].parts.at(-1)).toMatchObject({ type: 'text', text: '写到一半' });
  });

  test('a stop the server does not accept leaves the run going', async () => {
    const stream = liveStream();
    const { chat } = liveChat(stream, () => new Response('boom', { status: 500 }));
    chat.sendMessage({ text: 'x' });
    stream.push(...open('a1'));
    await until(() => chat.getSnapshot().messages.length === 2);
    await expect(chat.stop()).rejects.toThrow('500');
    expect(chat.isBusy).toBe(true);
    stream.close();
    await untilIdle(chat);
  });

  test('setMessages materializes and replaces the list', async () => {
    const { chat } = makeChat(() => new Response(sseBody(textRun)));
    chat.sendMessage({ text: 'x' });
    await untilIdle(chat);
    chat.setMessages((prev) => prev.slice(0, 1));
    expect(chat.getSnapshot().messages).toHaveLength(1);
    chat.setMessages([]);
    expect(chat.getSnapshot().messages).toHaveLength(0);
  });
});
