import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentMessage, Entry, Session } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import type { InteractionRequest } from '@shared/interactions';
import { INTERACTION_ENTRY } from '../project';
import { recoverInterruptedRun } from '../recovery';
import { sessionSqlite } from '../store/sqlite-driver';

/**
 * Recovery reads what a lost run left behind and closes it honestly. It runs
 * against a real session because what it may and may not write — ids, order,
 * one result per call — is the store's rule, not a fixture's.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function session() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-recovery-'));
  dirs.push(dir);
  const databasePath = join(dir, 'data.db');
  const repo = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dirname(databasePath) }),
    sqlite: sessionSqlite(new Database(databasePath)),
    databasePath,
  });
  return { repo, session: await repo.create({ cwd: '/tmp/work' }) };
}

const usage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const calling = (...ids: string[]): AgentMessage =>
  ({
    role: 'assistant',
    content: ids.map((id) => ({ type: 'toolCall', id, name: 'bash', arguments: {} })),
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-x',
    usage: usage(),
    stopReason: 'toolUse',
    timestamp: 2,
  }) as AgentMessage;

const result = (toolCallId: string, text: string): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content: [{ type: 'text', text }],
    details: text,
    isError: false,
    timestamp: 3,
  }) as AgentMessage;

const approval = (toolCallId: string): InteractionRequest => ({
  id: `ap-${toolCallId}`,
  runId: 'r1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: toolCallId, name: 'bash', arguments: {} },
  createdAt: 1,
});

/** Open a run and write what it managed to produce before it was lost. */
async function lostRun(s: Session, write: (s: Session) => Promise<void>): Promise<void> {
  await s.appendRecord({
    id: 'r1',
    lane: 'main',
    type: 'operation_started',
    sourceLeafId: await s.getLeafId(),
    intent: { kind: 'run', originalPrompt: [], initialMessages: [] },
  });
  await write(s);
}

const read = async (s: Session) => ({
  entries: await s.findEntriesOnBranch({ order: 'oldestFirst' }),
  records: await s.findRecords({ order: 'oldestFirst' }),
});

const detailsOf = (entry: Entry | undefined) =>
  entry?.type === 'message' && entry.message.role === 'toolResult'
    ? entry.message.details
    : undefined;

const resultsFor = (entries: Awaited<ReturnType<typeof read>>['entries'], toolCallId: string) =>
  entries.filter(
    (entry) =>
      entry.type === 'message' &&
      entry.message.role === 'toolResult' &&
      entry.message.toolCallId === toolCallId,
  );

test('a call that never returned is closed as unknown, and the run is closed', async () => {
  const { repo, session: s } = await session();
  await lostRun(s, async (s) => {
    await s.appendMessage(calling('c1'));
  });

  await recoverInterruptedRun(s, 'r1', 'app_shutdown');

  const { entries, records } = await read(s);
  const [sealed] = resultsFor(entries, 'c1');
  expect(sealed?.type === 'message' && sealed.message).toMatchObject({ isError: true });
  expect(detailsOf(sealed)).toBeUndefined();
  expect(records.find((record) => record.type === 'operation_finished')).toMatchObject({
    runId: 'r1',
    outcome: 'aborted',
  });
  expect(await s.findOpenOperations('main')).toEqual([]);
  await repo.close();
});

test('a real result is kept and never joined by a second one', async () => {
  const { repo, session: s } = await session();
  await lostRun(s, async (s) => {
    await s.appendMessage(calling('c1', 'c2'));
    await s.appendMessage(result('c1', 'the real output'));
  });

  await recoverInterruptedRun(s, 'r1', 'interrupted');

  const { entries } = await read(s);
  const kept = resultsFor(entries, 'c1');
  expect(kept).toHaveLength(1);
  expect(detailsOf(kept[0])).toBe('the real output');
  expect(resultsFor(entries, 'c2')).toHaveLength(1);
  await repo.close();
});

test('recovering twice writes nothing the first pass did not', async () => {
  const { repo, session: s } = await session();
  await lostRun(s, async (s) => {
    await s.appendMessage(calling('c1'));
  });

  await recoverInterruptedRun(s, 'r1', 'interrupted');
  const first = await read(s);
  // A second boot finds the same run: the ids are stable, so this must not throw.
  await recoverInterruptedRun(s, 'r1', 'interrupted');
  const second = await read(s);

  expect(second.entries).toHaveLength(first.entries.length);
  expect(second.records).toHaveLength(first.records.length);
  expect(resultsFor(second.entries, 'c1')).toHaveLength(1);
  await repo.close();
});

test('a decision nobody answered is recorded as interrupted, and an answered one is kept', async () => {
  const { repo, session: s } = await session();
  const asked = approval('c1');
  const decided = approval('c2');
  await lostRun(s, async (s) => {
    await s.appendMessage(calling('c1', 'c2'));
    await s.appendCustomEntry(INTERACTION_ENTRY, { phase: 'requested', request: asked });
    await s.appendCustomEntry(INTERACTION_ENTRY, { phase: 'requested', request: decided });
    await s.appendCustomEntry(INTERACTION_ENTRY, {
      phase: 'resolved',
      request: decided,
      outcome: { kind: 'denied', reason: 'No' },
    });
  });

  await recoverInterruptedRun(s, 'r1', 'user_cancelled');

  const { entries } = await read(s);
  const settlements = entries.filter(
    (entry): entry is Extract<Entry, { type: 'custom' }> =>
      entry.type === 'custom' &&
      entry.customType === INTERACTION_ENTRY &&
      (entry.data as { phase: string }).phase === 'resolved',
  );
  expect(settlements).toHaveLength(2);
  const outcomes = settlements.map(
    (entry) => (entry.data as { outcome: { kind: string } }).outcome.kind,
  );
  expect(outcomes.sort()).toEqual(['denied', 'interrupted']);
  // The call the user denied says so; the one nobody answered says it never ran.
  const denied = resultsFor(entries, 'c2')[0];
  const deniedText =
    denied?.type === 'message' && denied.message.role === 'toolResult'
      ? denied.message.content
      : undefined;
  expect(deniedText).toMatchObject([{ type: 'text', text: expect.stringContaining('denied') }]);
  await repo.close();
});

test('a run that already ended is left alone', async () => {
  const { repo, session: s } = await session();
  await lostRun(s, async (s) => {
    await s.appendMessage(calling('c1'));
    await s.appendMessage(result('c1', 'done'));
  });
  await s.appendRecord({
    id: 'r1-end',
    lane: 'main',
    type: 'operation_finished',
    runId: 'r1',
    outcome: 'completed',
  });
  const before = await read(s);

  await recoverInterruptedRun(s, 'r1', 'interrupted');

  const after = await read(s);
  expect(after.entries).toHaveLength(before.entries.length);
  expect(after.records.filter((record) => record.type === 'operation_finished')).toHaveLength(1);
  await repo.close();
});
