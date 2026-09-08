import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentMessage, Session } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import { APPROVAL_ENTRY, openToolCalls, projectHistory, projectMessages } from './project';
import { sessionSqlite } from './sqlite-driver';

/**
 * The projection is exercised against a real session rather than hand-built
 * entries: the shape it reads back — sequence numbers included — is the store's
 * to decide, and a fixture would be free to be wrong about it.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-project-'));
  dirs.push(dir);
  const databasePath = join(dir, 'data.db');
  const repo = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dirname(databasePath) }),
    sqlite: sessionSqlite(new Database(databasePath)),
    databasePath,
  });
  return { repo, session: await repo.create({ cwd: '/tmp/work' }) };
}

const usage = (input: number, output: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const user = (text: string): AgentMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 1,
});

const assistant = (content: unknown[]): AgentMessage =>
  ({
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-x',
    usage: usage(10, 5),
    stopReason: content.some((c) => (c as { type: string }).type === 'toolCall')
      ? 'toolUse'
      : 'stop',
    timestamp: 2,
  }) as AgentMessage;

const toolResult = (toolCallId: string, details: unknown): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content: [{ type: 'text', text: 'ok' }],
    details,
    isError: false,
    timestamp: 3,
  }) as AgentMessage;

/** Open a run, let the caller write into it, then close it. */
async function run(
  s: Session,
  id: string,
  write: (s: Session) => Promise<void>,
  opts: { finish?: boolean } = {},
): Promise<void> {
  await s.appendRecord({
    id,
    lane: 'main',
    type: 'operation_started',
    sourceLeafId: await s.getLeafId(),
    intent: { kind: 'run', originalPrompt: [], initialMessages: [] },
  });
  await write(s);
  if (opts.finish !== false) {
    await s.appendRecord({
      id: `${id}-end`,
      lane: 'main',
      type: 'operation_finished',
      runId: id,
      outcome: 'completed',
    });
  }
}

const read = async (s: Session) => ({
  entries: await s.findEntriesOnBranch({ order: 'oldestFirst' }),
  records: await s.findRecords({ order: 'oldestFirst' }),
});

test('a run folds into one assistant message carrying the user turn before it', async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('hello'));
    await s.appendMessage(assistant([{ type: 'text', text: 'hi there' }]));
  });

  const { entries, records } = await read(s);
  const messages = projectMessages(entries, records);
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(messages[0].parts).toEqual([{ type: 'text', text: 'hello' }]);
  expect(messages[1].id).toBe('r1');
  expect(messages[1].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'hi there' }]);
  await repo.close();
});

test('a tool call and its result merge into one card', async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('run ls'));
    await s.appendMessage(
      assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }]),
    );
    await s.appendMessage(toolResult('c1', { stdout: 'a.txt' }));
    await s.appendMessage(assistant([{ type: 'text', text: 'there is a.txt' }]));
  });

  const { entries, records } = await read(s);
  const [, reply] = projectMessages(entries, records);
  const tool = reply.parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1');
  expect(tool).toMatchObject({
    type: 'tool-bash',
    state: 'output-available',
    input: { command: 'ls' },
    output: { stdout: 'a.txt' },
  });
  // Two model turns, so two steps.
  expect(reply.parts.filter((p) => p.type === 'step-start')).toHaveLength(2);
  await repo.close();
});

test("run metadata is rebuilt from the run's own records", async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('hi'));
    const entryId = await s.appendMessage(assistant([{ type: 'text', text: 'yo' }]));
    await s.appendRecord({
      id: 'u1',
      lane: 'main',
      type: 'usage',
      cause: 'assistant',
      runId: 'r1',
      entryId,
      attempt: 1,
      stopReason: 'stop',
      usage: usage(100, 20),
    });
  });

  const { entries, records } = await read(s);
  const [, reply] = projectMessages(entries, records);
  expect(reply.metadata).toMatchObject({
    providerId: 'anthropic',
    modelId: 'claude-x',
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    contextTokens: 120,
  });
  expect(typeof reply.metadata?.durationMs).toBe('number');
  await repo.close();
});

test('a parked call keeps its approval card instead of spinning', async () => {
  const { repo, session: s } = await session();
  await run(
    s,
    'r1',
    async (s) => {
      await s.appendMessage(user('curl something'));
      await s.appendMessage(
        assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'curl x' } }]),
      );
      await s.appendCustomEntry(APPROVAL_ENTRY, { toolCallId: 'c1', approvalId: 'ap1' });
    },
    { finish: false },
  );

  const { entries, records } = await read(s);
  const [, reply] = projectMessages(entries, records);
  expect(reply.parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1')).toMatchObject(
    {
      state: 'approval-requested',
      approval: { id: 'ap1' },
    },
  );
  await repo.close();
});

test('two runs stay separate messages', async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('first'));
    await s.appendMessage(assistant([{ type: 'text', text: 'one' }]));
  });
  await run(s, 'r2', async (s) => {
    await s.appendMessage(user('second'));
    await s.appendMessage(assistant([{ type: 'text', text: 'two' }]));
  });

  const { entries, records } = await read(s);
  const messages = projectMessages(entries, records);
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  // The assistant messages are addressed by their run; the user turns keep
  // their own entry ids, so nothing collides.
  expect([messages[1].id, messages[3].id]).toEqual(['r1', 'r2']);
  expect(new Set(messages.map((m) => m.id)).size).toBe(4);
  expect(messages[1].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'one' }]);
  expect(messages[3].parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'two' }]);
  await repo.close();
});

test('the engine transcript is every message in order, records ignored', async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('hi'));
    await s.appendMessage(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }]));
    await s.appendMessage(toolResult('c1', 'done'));
  });

  const { entries } = await read(s);
  expect(projectHistory(entries).map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult']);
  await repo.close();
});

test('an unanswered call is reported as open', async () => {
  const { repo, session: s } = await session();
  await run(s, 'r1', async (s) => {
    await s.appendMessage(user('two calls'));
    await s.appendMessage(
      assistant([
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
        { type: 'toolCall', id: 'c2', name: 'bash', arguments: {} },
      ]),
    );
    await s.appendMessage(toolResult('c1', 'done'));
  });

  const { entries } = await read(s);
  expect(openToolCalls(entries).map((c) => c.id)).toEqual(['c2']);
  await repo.close();
});
