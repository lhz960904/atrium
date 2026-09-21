import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentEvent,
  AgentMessage,
  AgentMessage as Message,
  Session,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import type { InteractionRequest } from '@shared/interactions';

import { getAgentMessages, getUIMessages, INTERACTION_ENTRY } from '../project';
import { createSessionRecorder } from '../session-recorder';
import { Conversation } from '../store/conversation';
import { sessionSqlite } from '../store/sqlite-driver';

/**
 * Round-trip: what the recorder writes has to be exactly what the projection
 * reads back, so the two are exercised against each other rather than against
 * fixtures either one could be wrong about.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-session-recorder-'));
  dirs.push(dir);
  const databasePath = join(dir, 'data.db');
  const repo = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dirname(databasePath) }),
    sqlite: sessionSqlite(new Database(databasePath)),
    databasePath,
  });
  const created = await repo.create({ cwd: '/tmp/work' });
  return { repo, session: created, conversation: new Conversation(created) };
}

const usage = (input: number, output: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

let seq = 0;
const user = (text: string): { id: string; message: Message } => ({
  id: `u${++seq}`,
  message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
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

const request = (id: string): InteractionRequest => ({
  id,
  runId: 'r1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
  createdAt: 1,
});

const read = async (s: Session) => ({
  entries: await s.findEntriesOnBranch({ order: 'oldestFirst' }),
  records: await s.findRecords({ order: 'oldestFirst' }),
});

test('a turn is readable the moment its message lands, before the run ends', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('hi'));
  expect(recorder.messageId).toBeUndefined();
  await recorder.observe(ended(assistant([{ type: 'text', text: 'first half' }])));
  expect(recorder.messageId).toBe('r1');

  // No end() yet — this is what a crash mid-turn would leave behind.
  const { entries, records } = await read(s);
  expect(getAgentMessages(entries).map((m) => m.role)).toEqual(['user', 'assistant']);
  const [, reply] = getUIMessages(entries, records);
  expect(reply.parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'first half' }]);
  await repo.close();
});

test('an unfinished run leaves its operation open for a later boot to find', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('hi'));
  await recorder.observe(ended(assistant([{ type: 'text', text: 'partial' }])));

  expect((await s.findOpenOperations('main')).map((r) => r.id)).toEqual(['r1']);
  await recorder.end('aborted');
  expect(await s.findOpenOperations('main')).toEqual([]);
  await repo.close();
});

test('usage is recorded per turn and adds up on the run', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('hi'));
  await recorder.observe(
    ended(assistant([{ type: 'text', text: 'one' }], { usage: usage(100, 10) })),
  );
  await recorder.observe(
    ended(assistant([{ type: 'text', text: 'two' }], { usage: usage(200, 20) })),
  );
  await recorder.end('completed');

  expect(recorder.totals).toMatchObject({ input: 300, output: 30, total: 330 });
  expect(recorder.contextTokens).toBe(220);

  const { entries, records } = await read(s);
  expect(getUIMessages(entries, records)[1].metadata).toMatchObject({
    inputTokens: 300,
    outputTokens: 30,
    totalTokens: 330,
  });
  await repo.close();
});

test('a turn that produced nothing is not kept', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('hi'));
  await recorder.observe(
    ended(assistant([], { stopReason: 'error', errorMessage: 'upstream exploded' })),
  );
  await recorder.end('failed');

  expect(recorder.failure).toBe('upstream exploded');
  const { entries } = await read(s);
  // Only the user turn: an empty assistant message would be rejected as history.
  expect(getAgentMessages(entries).map((m) => m.role)).toEqual(['user']);
  await repo.close();
});

test('a message carrying undefined is still storable', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('run something'));
  await recorder.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  // What a tool actually returns: optional fields left unset rather than absent.
  // The store rejects undefined outright, and one rejected append fails the turn.
  await recorder.observe(
    ended({
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'ok' }],
      details: { stdout: 'ok', stderr: undefined, exitCode: 0 },
      isError: false,
      timestamp: 3,
    } as AgentMessage),
  );
  await recorder.end('completed');

  const { entries, records } = await read(s);
  const [, reply] = getUIMessages(entries, records);
  expect(reply.parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1')).toMatchObject(
    {
      state: 'output-available',
      output: { stdout: 'ok', exitCode: 0 },
    },
  );
  await repo.close();
});

test("the user's turn keeps the id it was sent under", async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  const prompt = user('find me later');
  await recorder.begin(prompt);
  await recorder.end('completed');

  // The live view addresses this message by that id, and editing it later has
  // to find the entry it became — a store-assigned id would never match.
  expect(await s.getEntry(prompt.id)).toMatchObject({ type: 'message' });
  const { entries, records } = await read(s);
  expect(getUIMessages(entries, records)[0].id).toBe(prompt.id);
  await repo.close();
});

test('a new run closes one that never got to end', async () => {
  const { repo, session: s, conversation } = await session();
  const first = createSessionRecorder({ conversation, runId: 'r1' });
  await first.begin(user('curl x'));
  await first.observe(ended(assistant([{ type: 'text', text: 'cut off' }])));

  // The process died before the first run could end. The lane holds one
  // operation at a time, so the next run only opens once that one is closed.
  const second = createSessionRecorder({ conversation, runId: 'r2' });
  await second.begin(user('try again'));
  await second.observe(ended(assistant([{ type: 'text', text: 'done' }])));
  await second.end('completed');

  expect(await s.findOpenOperations('main')).toEqual([]);
  const { entries, records } = await read(s);
  const abandoned = records.find((r) => r.type === 'operation_finished' && r.runId === 'r1');
  expect(abandoned).toMatchObject({ outcome: 'aborted' });
  const messages = getUIMessages(entries, records);
  expect(messages.map((m) => m.id)).toEqual([messages[0].id, 'r1', messages[2].id, 'r2']);
  await repo.close();
});

test("a lost run's gap is repaired before the next run opens", async () => {
  const { repo, session: s, conversation } = await session();
  const first = createSessionRecorder({ conversation, runId: 'r1' });
  await first.begin(user('curl x'));
  await first.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  // The process dies here: no tool result, no end.

  const prompt = user('try again');
  const second = createSessionRecorder({ conversation, runId: 'r2' });
  await second.begin(prompt);
  await second.end('completed');

  const { entries, records } = await read(s);
  const repaired = entries.find(
    (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
  );
  const opened = records.find(
    (record) => record.type === 'operation_started' && record.id === 'r2',
  );
  const asked = entries.find((entry) => entry.id === prompt.id);
  // The repair belongs to the run that was lost, so it lands before the new one.
  expect(repaired?.seq).toBeLessThan(opened?.seq ?? 0);
  expect(asked?.seq).toBeGreaterThan(opened?.seq ?? 0);
  expect(records.find((r) => r.type === 'operation_finished' && r.runId === 'r1')).toMatchObject({
    outcome: 'aborted',
  });
  await repo.close();
});

test('an approval is recorded once when asked and once when decided', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('curl x'));
  await recorder.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  const asked = request('00000000-0000-4000-8000-000000000001');
  await recorder.interactionRequested(asked);

  let { entries, records } = await read(s);
  const card = (parts: readonly unknown[]) =>
    parts.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1');
  expect(card(getUIMessages(entries, records)[1].parts)).toMatchObject({
    state: 'approval-requested',
    approval: { id: asked.id },
  });

  await recorder.interactionResolved(asked, { kind: 'denied', reason: 'not now' });
  ({ entries, records } = await read(s));
  expect(
    entries.filter((entry) => entry.type === 'custom' && entry.customType === INTERACTION_ENTRY),
  ).toHaveLength(2);
  expect(card(getUIMessages(entries, records)[1].parts)).toMatchObject({
    state: 'output-denied',
    approval: { id: asked.id, approved: false },
  });
  await repo.close();
});

test('a stopped run still hands the model a result next to the call', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('run it'));
  await recorder.observe(
    ended(
      assistant([
        { type: 'text', text: 'running' },
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
      ]),
    ),
  );
  await recorder.end('aborted', 'user_cancelled');

  // The stop reason is stored between the call and its stand-in result, and pi
  // leaves custom entries out of the context it builds — so a provider still
  // sees the result immediately after the call it answers, as it requires.
  const { entries } = await read(s);
  expect(getAgentMessages(entries).map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult']);
  await repo.close();
});

test('the error result a blocked call produces is kept as its real result', async () => {
  const { repo, session: s, conversation } = await session();
  const recorder = createSessionRecorder({ conversation, runId: 'r1' });
  await recorder.begin(user('curl x'));
  await recorder.observe(
    ended(assistant([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }])),
  );
  await recorder.observe(
    ended({
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'The user denied this operation.' }],
      details: {},
      isError: true,
      timestamp: 3,
    } as AgentMessage),
  );
  await recorder.end('completed');

  const { entries } = await read(s);
  expect(getAgentMessages(entries).filter((m) => m.role === 'toolResult')).toHaveLength(1);
  await repo.close();
});
