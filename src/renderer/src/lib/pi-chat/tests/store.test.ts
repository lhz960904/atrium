import { describe, expect, test } from 'bun:test';
import type { AtriumUIMessage } from '@shared/chat';
import type { AgentSessionEvent, AssistantMessage, Content } from '@shared/protocol';
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

describe('continuations', () => {
  const clarifyMessage = (output?: unknown): AtriumUIMessage => ({
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-ask_clarification',
        toolCallId: 'c1',
        state: output === undefined ? 'input-available' : 'output-available',
        input: { questions: [] },
        ...(output === undefined ? {} : { output }),
      } as AtriumUIMessage['parts'][number],
    ],
    metadata: { createdAt: 1 },
  });

  test('an answered clarification resumes its run with the answer as a decision', async () => {
    const { chat, calls } = makeChat(
      () => new Response(sseBody(sayText('a1', '收到'))),
      [clarifyMessage()],
    );
    chat.addToolOutput({ tool: 'ask_clarification', toolCallId: 'c1', output: { answers: ['A'] } });
    await untilIdle(chat);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://test/api/chat/t1/resume');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.runId).toBe('a1');
    expect(body.decisions).toEqual([
      { toolCallId: 'c1', kind: 'answered', output: { answers: ['A'] } },
    ]);
    // The continuation extends the same message: clarify part kept, reply appended.
    const snap = chat.getSnapshot();
    expect(snap.messages).toHaveLength(1);
    const types = snap.messages[0].parts.map((p) => p.type);
    expect(types).toContain('tool-ask_clarification');
    expect(snap.messages[0].parts.at(-1)).toMatchObject({ type: 'text', text: '收到' });
  });

  test('a cancelled clarification does not resume', async () => {
    const { chat, calls } = makeChat(() => new Response(sseBody(textRun)), [clarifyMessage()]);
    chat.addToolOutput({
      tool: 'ask_clarification',
      toolCallId: 'c1',
      output: { answers: [], cancelled: true },
    });
    await Bun.sleep(50);
    expect(calls).toHaveLength(0);
    expect(chat.getSnapshot().status).toBe('ready');
  });

  test('an approval response auto-resumes and the tool then executes', async () => {
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
    const { chat, calls } = makeChat(
      () =>
        new Response(
          sseBody([
            ...open('a1'),
            {
              type: 'tool_execution_end',
              toolCallId: 'b1',
              toolName: 'bash',
              result: { content: [], details: { stdout: 'ok' } },
              isError: false,
            },
            ...close('a1', []),
          ]),
        ),
      [paused],
    );
    chat.addToolApprovalResponse({ id: 'ap1', approved: true });
    await untilIdle(chat);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://test/api/chat/t1/resume');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.runId).toBe('a1');
    expect(body.decisions).toEqual([{ toolCallId: 'b1', kind: 'approved' }]);
    // The seeded part got its execution result under the original toolCallId.
    const bash = chat
      .getSnapshot()
      .messages[0].parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'b1');
    expect(bash).toMatchObject({ state: 'output-available', output: { stdout: 'ok' } });
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

  test('stop settles immediately and keeps streamed content', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const partial = sseBody(textRun);
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(partial.slice(0, partial.indexOf('\n\n') + 2)));
        await gate;
        controller.close();
      },
    });
    const { chat } = makeChat(() => new Response(body));
    chat.sendMessage({ text: 'x' });
    await Bun.sleep(50);
    chat.stop();
    expect(chat.getSnapshot().status).toBe('ready');
    release();
    await Bun.sleep(20);
    expect(chat.getSnapshot().status).toBe('ready');
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
