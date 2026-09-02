import { expect, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { AgentSessionEvent, Message } from '@shared/protocol';
import type { Db } from '../db';
import { type RunRow, runAgent } from './run';
import type { Sandbox } from './sandbox/types';

const MODEL = {
  id: 'm1',
  name: 'm1',
  api: 'anthropic-messages',
  provider: 'p1',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
} as unknown as Model<'anthropic-messages'>;

const usage = () => ({
  input: 3,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** A stream function that answers with one text block and stops. */
function textStream(text: string): StreamFn {
  return () => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text }],
      api: 'anthropic-messages',
      provider: 'p1',
      model: 'm1',
      usage: usage(),
      stopReason: 'stop',
      timestamp: 1,
    };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: { ...message, content: [] } });
      stream.push({ type: 'text_start', contentIndex: 0, partial: { ...message, content: [] } });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
      stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end(message);
    });
    return stream;
  };
}

const userMessage = (text: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 0,
});

async function runOnce(text: string) {
  const events: AgentSessionEvent[] = [];
  let stored: { rows: RunRow[]; markRead: boolean } | undefined;
  await runAgent({
    runId: 'run-1',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: textStream(text),
    getApiKey: () => 'key',
    model: {} as never,
    messages: [userMessage('hi')],
    uiMessages: [],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    permissionMode: 'default',
    buildTools: () => ({ tools: [], aiSdk: {} }),
    emit: (event) => events.push(event),
    persist: (rows, opts) => {
      stored = { rows, markRead: opts.markRead };
    },
  });
  return { events, stored };
}

test('projects the run onto the wire, opening and closing the assistant message', async () => {
  const { events } = await runOnce('Hello world');
  const types = events.map((e) => e.type);
  expect(types).toContain('agent_start');
  expect(types.at(-1)).toBe('agent_end');

  const start = events.find((e) => e.type === 'message_start');
  expect(start && 'messageId' in start && start.messageId).toBe('run-1');

  const deltas = events.flatMap((e) =>
    e.type === 'message_update' && e.assistantMessageEvent.type === 'text_delta'
      ? [e.assistantMessageEvent.delta]
      : [],
  );
  expect(deltas.join('')).toBe('Hello world');
});

test('stream frames carry deltas only, never the cumulative message', async () => {
  const { events } = await runOnce('abc');
  for (const event of events) {
    if (event.type !== 'message_update') continue;
    expect(event.assistantMessageEvent).not.toHaveProperty('partial');
  }
});

test('stores the run as one assistant row carrying the turn metadata', async () => {
  const { stored } = await runOnce('done');
  expect(stored?.rows).toHaveLength(1);
  const [row] = stored?.rows ?? [];
  expect(row.id).toBe('run-1:0');
  expect(row.role).toBe('assistant');
  expect((row.message as { content: unknown[] }).content).toEqual([{ type: 'text', text: 'done' }]);
  // The reader takes the run's observability off its first row.
  expect(row.metadata).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
});

test('reports the turn to the usage ledger once', async () => {
  const seen: unknown[] = [];
  await runAgent({
    runId: 'run-2',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: textStream('x'),
    getApiKey: () => 'key',
    model: {} as never,
    messages: [userMessage('hi')],
    uiMessages: [],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    permissionMode: 'default',
    buildTools: () => ({ tools: [], aiSdk: {} }),
    emit: () => {},
    persist: () => {},
    recordUsage: (u) => seen.push(u),
  });
  expect(seen).toEqual([
    {
      messageId: 'run-2',
      providerId: 'p1',
      modelId: 'm1',
      inputTokens: 3,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 5,
    },
  ]);
});
