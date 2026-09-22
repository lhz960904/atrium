import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { Usage } from '@earendil-works/pi-ai';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import type { RatesResolver } from '@main/conversation/usage';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { Conversation } from '../store/conversation';
import { sessionSqlite } from '../store/sqlite-driver';
import { usageDaily, usageDailyByModel, usageSummary } from '../usage';

/**
 * The reports read records written through the real store, because what they
 * depend on — where the model is, which records carry a runId, what a side
 * call's details look like — is the store's shape, and a hand-built fixture
 * would be free to be wrong about all of it.
 */

const DAY = 86_400_000;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const usage = (input: number, cacheRead: number, cost: number): Usage => ({
  input,
  output: 1,
  cacheRead,
  cacheWrite: 0,
  totalTokens: input + cacheRead + 1,
  cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

const turn = (provider: string, model: string): AgentMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    api: 'anthropic-messages',
    provider,
    model,
    usage: usage(0, 0, 0),
    stopReason: 'stop',
    timestamp: 1,
  }) as AgentMessage;

async function ledger() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-usage-'));
  dirs.push(dir);
  const databasePath = join(dir, 'data.db');
  const raw = new Database(databasePath);
  raw.run(`CREATE TABLE threads (
    id text PRIMARY KEY NOT NULL, title text, project_id text, metadata text,
    model_provider_id text, model_id text,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL,
    last_read_at integer, archived_at integer, deleted_at integer,
    pinned integer DEFAULT false NOT NULL, session_id text)`);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
  const repository = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dirname(databasePath) }),
    sqlite: sessionSqlite(raw),
    databasePath,
  });
  // Boot does exactly this, and for the same reason: listing is what runs the
  // store's migrations, so its tables exist before anything reads them.
  await repository.list();

  let n = 0;
  /**
   * A thread that ran once. `touchedAt` is what the range filter reads and
   * `at` is when the spend happened, so the two can be set apart on purpose.
   */
  const spent = async (opts: {
    at: number;
    touchedAt?: number;
    model?: [string, string];
    chat?: { input: number; cacheRead: number; cost: number };
    side?: { kind: 'title' | 'subagent'; model: [string, string]; cost: number };
    deleted?: boolean;
  }) => {
    const id = `t${n++}`;
    const session = await repository.create({ cwd: '/tmp/work' });
    const conversation = new Conversation(session);
    const { id: sessionId } = await session.getMetadata();
    db.insert(schema.threads)
      .values({
        id,
        sessionId,
        updatedAt: new Date(opts.touchedAt ?? opts.at),
        deletedAt: opts.deleted ? new Date(opts.at) : null,
      })
      .run();

    const runId = `${id}-r1`;
    await conversation.startRun(runId);
    if (opts.chat) {
      const [provider, model] = opts.model ?? ['anthropic', 'claude-x'];
      const entryId = await conversation.appendTurn(turn(provider, model));
      await conversation.recordUsage({
        runId,
        entryId,
        attempt: 1,
        stopReason: 'stop',
        usage: usage(opts.chat.input, opts.chat.cacheRead, opts.chat.cost),
      });
    }
    if (opts.side) {
      await conversation.recordSideUsage({
        kind: opts.side.kind,
        usage: usage(1, 0, opts.side.cost),
        providerId: opts.side.model[0],
        modelId: opts.side.model[1],
        runId,
      });
    }
    await conversation.finishRun(runId, 'completed');
    // pi stamps a record as it is appended; the history is ours to place.
    raw.query(`UPDATE records SET timestamp = ? WHERE session_id = ?`).run(opts.at, sessionId);
    return id;
  };

  return { db, repository, spent };
}

const noRates: RatesResolver = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const localDay = (at: number) => new Date(at).toLocaleDateString('en-CA');

test('an empty period answers with zeros rather than with nothing', async () => {
  const { db, repository } = await ledger();
  const summary = usageSummary(db, 'month', noRates);
  expect(summary).toMatchObject({ totalTokens: 0, calls: 0, totalCostUsd: 0, cacheHitRate: 0 });
  expect(usageDaily(db, 'month')).toEqual([]);
  await repository.close();
});

test('a chat is attributed to the turn that ran it, a side call to its own model', async () => {
  const { db, repository, spent } = await ledger();
  await spent({
    at: Date.now() - DAY,
    model: ['anthropic', 'claude-x'],
    chat: { input: 100, cacheRead: 0, cost: 0.5 },
    side: { kind: 'title', model: ['openai', 'gpt-mini'], cost: 0.01 },
  });

  const { models, rows } = usageDailyByModel(db, '7d');
  // Nothing tells the report which model a turn used; it is read off the turn.
  expect(models).toEqual(['claude-x', 'gpt-mini']);
  expect(rows.map((r) => r.modelId).sort()).toEqual(['claude-x', 'gpt-mini']);
  expect(usageSummary(db, '7d', noRates)).toMatchObject({ calls: 2, chatCalls: 1 });
  await repository.close();
});

test('a thread untouched since the range began is never opened', async () => {
  const { db, repository, spent } = await ledger();
  // Spend inside the range, on a thread whose row says it has not been touched
  // since — impossible in practice, because a run always touches its thread,
  // and the point of the filter is that it may then be skipped.
  await spent({
    at: Date.now() - DAY,
    touchedAt: Date.now() - 90 * DAY,
    chat: { input: 10, cacheRead: 0, cost: 1 },
  });
  await spent({ at: Date.now() - DAY, chat: { input: 10, cacheRead: 0, cost: 2 } });

  expect(usageSummary(db, '7d', noRates).totalCostUsd).toBeCloseTo(2, 10);
  // Widen the range and the same rows come back — nothing was lost, only scoped.
  expect(usageSummary(db, 'all', noRates).totalCostUsd).toBeCloseTo(3, 10);
  await repository.close();
});

test('spend on a deleted thread still counts', async () => {
  const { db, repository, spent } = await ledger();
  await spent({
    at: Date.now() - DAY,
    deleted: true,
    chat: { input: 10, cacheRead: 0, cost: 0.25 },
  });

  // Deleting a chat cannot retroactively change what last week cost — which is
  // why deleting is a mark and the session is kept.
  expect(usageSummary(db, '7d', noRates).totalCostUsd).toBeCloseTo(0.25, 10);
  await repository.close();
});

test('cache savings are priced by the caller, per model, never below zero', async () => {
  const { db, repository, spent } = await ledger();
  await spent({
    at: Date.now() - DAY,
    model: ['anthropic', 'dear'],
    chat: { input: 100, cacheRead: 1000, cost: 0.1 },
  });
  await spent({
    at: Date.now() - DAY,
    model: ['anthropic', 'odd'],
    chat: { input: 100, cacheRead: 2000, cost: 0.1 },
  });

  const asked: string[] = [];
  const summary = usageSummary(db, '7d', (providerId, modelId) => {
    asked.push(`${providerId}/${modelId}`);
    // 'odd' charges more for a cache read than for a fresh input token, so the
    // saving would be negative — which is not a saving.
    return modelId === 'dear'
      ? { input: 0.00001, output: 0, cacheRead: 0.000001, cacheCreation: 0 }
      : { input: 0.000001, output: 0, cacheRead: 0.00001, cacheCreation: 0 };
  });

  expect(asked.sort()).toEqual(['anthropic/dear', 'anthropic/odd']);
  expect(summary.cacheSavedUsd).toBeCloseTo(1000 * 0.000009, 10);
  expect(summary.cacheHitRate).toBeCloseTo(3000 / 200, 10);
  await repository.close();
});

test('days are grouped in local time, and the cost is the one that was recorded', async () => {
  const { db, repository, spent } = await ledger();
  const today = Date.now();
  await spent({ at: today, chat: { input: 10, cacheRead: 0, cost: 0.03 } });
  await spent({ at: today - DAY, chat: { input: 10, cacheRead: 0, cost: 0.04 } });

  const days = usageDaily(db, '7d');
  expect(days).toHaveLength(2);
  expect(days.at(-1)).toMatchObject({ date: localDay(today) });
  expect(days.at(-1)?.costUsd).toBeCloseTo(0.03, 10);
  await repository.close();
});
