import { expect, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import type { AgentSessionEvent, Message } from '@shared/protocol';
import type { Db } from '../db';
import type { RunJournal } from '../session/journal';
import { runAgent } from './run';
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

/**
 * Stands in for the session so these tests stay about what the run hands over.
 * That the store keeps it faithfully is the journal's own round-trip test.
 */
function recordingJournal() {
  const written: Message[] = [];
  const parked: string[] = [];
  let outcome: string | undefined;
  let failure: string | undefined;
  const journal: RunJournal = {
    begin: async (prompt) => {
      if (prompt) written.push(prompt.message);
    },
    observe: async (event) => {
      if (event.type !== 'message_end') return;
      const message = event.message as Message;
      written.push(message);
      // The one part of the journal's reading the run depends on: a provider
      // failure arrives as an errored turn, not an exception.
      if (message.role === 'assistant' && message.stopReason === 'error') {
        failure = message.errorMessage ?? 'the model call failed';
      }
    },
    park: async (call) => {
      parked.push(call.toolCallId);
    },
    end: async (result) => {
      outcome = result;
    },
    totals: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, total: 5 },
    get failure() {
      return failure;
    },
    contextTokens: 5,
    wrote: true,
  };
  return {
    journal,
    written,
    parked,
    get outcome() {
      return outcome;
    },
  };
}

async function runOnce(text: string) {
  const events: AgentSessionEvent[] = [];
  const recording = recordingJournal();
  await runAgent({
    runId: 'run-1',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: textStream(text),
    getApiKey: () => 'key',
    messages: [userMessage('hi')],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    skills: [],
    permissionMode: 'default',
    permission: { mode: 'default' },
    buildTools: () => [],
    emit: (event) => events.push(event),
    journal: recording.journal,
  });
  return { events, recording };
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

test('hands the finished turn to the journal and closes the run', async () => {
  const { events, recording } = await runOnce('done');
  expect(recording.written.map((m) => m.role)).toEqual(['assistant']);
  expect((recording.written[0] as { content: unknown[] }).content).toEqual([
    { type: 'text', text: 'done' },
  ]);
  expect(recording.outcome).toBe('completed');
  // The card's live figures still ride the wire, whatever the store keeps.
  const metadata = events.findLast((e) => e.type === 'notice' && e.name === 'message-metadata');
  expect(metadata && 'payload' in metadata && metadata.payload).toMatchObject({
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
  });
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
    messages: [userMessage('hi')],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    skills: [],
    permissionMode: 'default',
    permission: { mode: 'default' },
    buildTools: () => [],
    emit: () => {},
    journal: recordingJournal().journal,
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

/** Answers with one tool call, then wraps up in text — so an executed call
 *  doesn't loop the fake model forever. */
function toolCallStream(name: string, args: Record<string, unknown>): StreamFn {
  let asked = false;
  return (model, context, options) => {
    if (asked) return textStream('done')(model, context, options);
    asked = true;
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name, arguments: args }],
      api: 'anthropic-messages',
      provider: 'p1',
      model: 'm1',
      usage: usage(),
      stopReason: 'toolUse',
      timestamp: 1,
    };
    queueMicrotask(() => {
      stream.push({ type: 'start', partial: { ...message, content: [] } });
      stream.push({ type: 'done', reason: 'toolUse', message });
      stream.end(message);
    });
    return stream;
  };
}

const parkTool = (name: string, clientSide?: true) =>
  ({
    name,
    label: name,
    description: '',
    parameters: { type: 'object' },
    clientSide,
    execute: async () => ({ content: [{ type: 'text', text: 'ran' }], details: 'ran' }),
  }) as never;

async function runParking(tool: unknown, args: Record<string, unknown>, name: string) {
  const events: AgentSessionEvent[] = [];
  const recording = recordingJournal();
  await runAgent({
    runId: 'run-3',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: toolCallStream(name, args),
    getApiKey: () => 'key',
    messages: [userMessage('go')],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    skills: [],
    permissionMode: 'default',
    permission: { mode: 'default' },
    buildTools: () => [tool as never],
    emit: (event) => events.push(event),
    journal: recording.journal,
  });
  return { events, recording };
}

test('a call the user must answer ends the turn with the call left parked', async () => {
  const { events, recording } = await runParking(
    parkTool('ask_clarification', true),
    { questions: [] },
    'ask_clarification',
  );

  // Parked, and the run left open so the decision can still extend it.
  expect(recording.parked).toEqual(['call-1']);
  expect(recording.outcome).toBeUndefined();
  // And no refusal frame on the wire — the card is showing the question.
  expect(events.some((e) => e.type === 'tool_execution_end')).toBe(false);
  expect(events.at(-1)?.type).toBe('agent_end');
});

test('a boundary crossing asks for approval and parks the call under it', async () => {
  const { events, recording } = await runParking(
    parkTool('bash'),
    { command: 'curl https://example.invalid' },
    'bash',
  );

  const asked = events.find((e) => e.type === 'approval_requested');
  expect(asked).toBeDefined();
  if (asked?.type !== 'approval_requested') return;
  expect(asked.toolCallId).toBe('call-1');
  expect(recording.parked).toEqual(['call-1']);
  expect(recording.outcome).toBeUndefined();
});

test('full access runs the same call without asking', async () => {
  const events: AgentSessionEvent[] = [];
  const recording = recordingJournal();
  await runAgent({
    runId: 'run-4',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: toolCallStream('bash', { command: 'curl https://example.invalid' }),
    getApiKey: () => 'key',
    messages: [userMessage('go')],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    skills: [],
    permissionMode: 'full-access',
    permission: { mode: 'full-access' },
    buildTools: () => [parkTool('bash')],
    emit: (event) => events.push(event),
    journal: recording.journal,
  });
  expect(events.some((e) => e.type === 'approval_requested')).toBe(false);
  expect(recording.parked).toEqual([]);
  expect(recording.written.some((m) => m.role === 'toolResult')).toBe(true);
});

/** A stream that fails before producing any block, the way a dropped connection does. */
const erroringStream: StreamFn = () => {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'p1',
    model: 'm1',
    usage: usage(),
    stopReason: 'error',
    errorMessage: 'Connection error.',
    timestamp: 1,
  } as unknown as AssistantMessage;
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: 'error', message } as never);
    stream.end(message);
  });
  return stream;
};

test('a turn that failed at the provider is reported as a failed run', async () => {
  const events: AgentSessionEvent[] = [];
  const recording = recordingJournal();
  const result = await runAgent({
    runId: 'run-5',
    providerId: 'p1',
    modelId: 'm1',
    piModel: MODEL,
    streamFn: erroringStream,
    getApiKey: () => 'key',
    messages: [userMessage('hi')],
    workspaceRoot: '/ws',
    threadId: 't1',
    db: {} as Db,
    sandbox: {} as Sandbox,
    skills: [],
    permissionMode: 'default',
    permission: { mode: 'default' },
    buildTools: () => [],
    emit: (event) => events.push(event),
    journal: recording.journal,
  });
  expect(result).toMatchObject({ status: 'error', error: 'Connection error.' });
  expect(recording.outcome).toBe('failed');
  // A provider failure is encoded in the stream rather than thrown, so the run
  // still closes normally — the renderer reads the error off the turn itself.
  expect(events.at(-1)?.type).toBe('agent_end');
});
