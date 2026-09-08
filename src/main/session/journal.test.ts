import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentEvent, AgentMessage, Session } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import type { Message } from '@shared/protocol';
import { createRunJournal } from './journal';
import { projectHistory, projectMessages } from './project';
import { sessionSqlite } from './sqlite-driver';

/**
 * Round-trip: what the journal writes has to be exactly what the projection
 * reads back, so the two are exercised against each other rather than against
 * fixtures either one could be wrong about.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-journal-'));
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

const user = (text: string): Message => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 1,
});

const assistant = (content: unknown[], extra: Record<string, unknown> = {}): AgentMessage =>
  ({
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-x',
    usage: usage(10, 5),
    stopReason: 'stop',
    timestamp: 2,
    ...extra,
  }) as AgentMessage;

const ended = (message: AgentMessage): AgentEvent =>
  ({ type: 'message_end', message }) as AgentEvent;

const read = async (s: Session) => ({
  entries: await s.findEntriesOnBranch({ order: 'oldestFirst' }),
  records: await s.findRecords({ order: 'oldestFirst' }),
});

test('a turn is readable the moment its message lands, before the run ends', async () => {
  const { repo, session: s } = await session();
  const journal = createRunJournal({ session: s, runId: 'r1' });
  await journal.begin(user('hi'));
  await journal.observe(ended(assistant([{ type: 'text', text: 'first half' }])));

  // No end() yet — this is what a crash mid-turn would leave behind.
  const { entries, records } = await read(s);
  expect(projectHistory(entries).map((m) => m.role)).toEqual(['user', 'assistant']);
  const [, reply] = projectMessages(entries, records);
  expect(reply.parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'first half' }]);
  await repo.close();
});

test('an unfinished run leaves its operation open for a later boot to find', async () => {
  const { repo, session: s } = await session();
  const journal = createRunJournal({ session: s, runId: 'r1' });
  await journal.begin(user('hi'));
  await journal.observe(ended(assistant([{ type: 'text', text: 'partial' }])));

  expect((await s.findOpenOperations('main')).map((r) => r.id)).toEqual(['r1']);
  await journal.end('aborted');
  expect(await s.findOpenOperations('main')).toEqual([]);
  await repo.close();
});

test('usage is recorded per turn and adds up on the run', async () => {
  const { repo, session: s } = await session();
  const journal = createRunJournal({ session: s, runId: 'r1' });
  await journal.begin(user('hi'));
  await journal.observe(
    ended(assistant([{ type: 'text', text: 'one' }], { usage: usage(100, 10) })),
  );
  await journal.observe(
    ended(assistant([{ type: 'text', text: 'two' }], { usage: usage(200, 20) })),
  );
  await journal.end('completed');

  expect(journal.totals).toMatchObject({ input: 300, output: 30, total: 330 });
  expect(journal.contextTokens).toBe(220);

  const { entries, records } = await read(s);
  expect(projectMessages(entries, records)[1].metadata).toMatchObject({
    inputTokens: 300,
    outputTokens: 30,
    totalTokens: 330,
  });
  await repo.close();
});

test('a turn that produced nothing is not kept', async () => {
  const { repo, session: s } = await session();
  const journal = createRunJournal({ session: s, runId: 'r1' });
  await journal.begin(user('hi'));
  await journal.observe(
    ended(assistant([], { stopReason: 'error', errorMessage: 'upstream exploded' })),
  );
  await journal.end('failed');

  expect(journal.failure).toBe('upstream exploded');
  const { entries } = await read(s);
  // Only the user turn: an empty assistant message would be rejected as history.
  expect(projectHistory(entries).map((m) => m.role)).toEqual(['user']);
  await repo.close();
});

test('a parked call comes back as its approval card', async () => {
  const { repo, session: s } = await session();
  const journal = createRunJournal({ session: s, runId: 'r1' });
  await journal.begin(user('curl x'));
  await journal.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  await journal.park({ toolCallId: 'c1', approvalId: 'ap1' });

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

test('a continuation extends the run it resumes instead of opening a second one', async () => {
  const { repo, session: s } = await session();
  const first = createRunJournal({ session: s, runId: 'r1' });
  await first.begin(user('curl x'));
  await first.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  await first.park({ toolCallId: 'c1', approvalId: 'ap1' });

  // The user approves; the run resumes under the same id.
  const resumed = createRunJournal({ session: s, runId: 'r1', resuming: true });
  await resumed.begin();
  await resumed.observe(
    ended({
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'ok' }],
      details: 'ok',
      isError: false,
      timestamp: 3,
    } as AgentMessage),
  );
  await resumed.observe(ended(assistant([{ type: 'text', text: 'done' }])));
  await resumed.end('completed');

  const { entries, records } = await read(s);
  expect(records.filter((r) => r.type === 'operation_started')).toHaveLength(1);
  const messages = projectMessages(entries, records);
  // Still one user turn and one assistant message, not two of each.
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(messages[1].id).toBe('r1');
  expect(
    messages[1].parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1'),
  ).toMatchObject({ state: 'output-available', output: 'ok' });
  await repo.close();
});
