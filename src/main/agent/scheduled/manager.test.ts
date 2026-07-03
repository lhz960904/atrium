import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Db } from '../../db';
import type { ScheduledTask } from '../../db/schema';
import * as schema from '../../db/schema';
import { threads } from '../../db/schema';
import { ScheduledTaskManager, type ScheduledTaskView } from './manager';
import type { ScheduledRunResult } from './run';

// croner schedules real timers on schedule(); dispose() stops them so a test's
// pending job never leaks into the next.
const opened: ScheduledTaskManager[] = [];
afterEach(() => {
  for (const m of opened) m.dispose();
  opened.length = 0;
});

// bun:sqlite (better-sqlite3 is a native module Bun's test runtime can't load).
// Only the tables the manager touches are created — no FTS/jieba dependency, so
// no full-migration run is needed. The manager's DB type is better-sqlite3's;
// the query API is identical, so the bun-sqlite instance is cast to it.
function makeDb(): Db {
  const raw = new Database(':memory:');
  raw.run('PRAGMA foreign_keys = ON');
  raw.run(`CREATE TABLE threads (
    id text PRIMARY KEY NOT NULL, title text, project_id text, metadata text,
    created_at integer DEFAULT (unixepoch()*1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch()*1000) NOT NULL,
    last_read_at integer, archived_at integer, pinned integer DEFAULT false NOT NULL)`);
  raw.run(`CREATE TABLE scheduled_tasks (
    id text PRIMARY KEY NOT NULL, title text NOT NULL, prompt text NOT NULL, thread_id text,
    kind text NOT NULL, cron_expr text, run_at integer, timezone text NOT NULL,
    enabled integer DEFAULT true NOT NULL, project_id text, provider_id text, model_id text,
    permission_mode text DEFAULT 'full-access' NOT NULL,
    catch_up_policy text DEFAULT 'fire_once' NOT NULL,
    created_at integer DEFAULT (unixepoch()*1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch()*1000) NOT NULL)`);
  raw.run(`CREATE TABLE scheduled_task_runs (
    id text PRIMARY KEY NOT NULL,
    task_id text NOT NULL REFERENCES scheduled_tasks(id) ON DELETE cascade,
    message_id text, status text NOT NULL, error text,
    started_at integer DEFAULT (unixepoch()*1000) NOT NULL, finished_at integer)`);
  return drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
}

const START = 1_700_000_000_000;

function setup(runner?: (task: ScheduledTask) => Promise<ScheduledRunResult>) {
  const db = makeDb();
  const nowRef = { v: START };
  const mgr = new ScheduledTaskManager();
  mgr.init({
    db,
    endpoint: { port: 0, token: 't' },
    defaultModel: () => ({ providerId: 'p', modelId: 'm' }),
    now: () => nowRef.v,
    run: runner ?? (async () => ({ status: 'ok', messageId: 'a1' })),
  });
  opened.push(mgr);
  return { mgr, db, nowRef };
}

function view(mgr: ScheduledTaskManager, id: string): ScheduledTaskView {
  const v = mgr.getView(id);
  if (!v) throw new Error(`no view for ${id}`);
  return v;
}

const RECURRING = {
  title: 'News',
  prompt: 'summarize',
  kind: 'recurring',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
} as const;

test('create leaves the thread lazy; derives next run and empty state', () => {
  const { mgr } = setup();
  const task = mgr.create({ ...RECURRING });

  // No conversation until the task first runs.
  expect(task.threadId).toBeNull();
  expect(task.permissionMode).toBe('full-access');
  expect(task.nextRunAt).toBeInstanceOf(Date);
  expect((task.nextRunAt as Date).getTime()).toBeGreaterThan(START);
  // Fresh task: no runs yet → derived state is empty.
  expect(task.lastRunAt).toBeNull();
  expect(task.consecutiveFailures).toBe(0);
});

test('the bound thread is created on first fire and back-references the task', async () => {
  const { mgr, db } = setup();
  const task = mgr.create({ ...RECURRING });
  expect(task.threadId).toBeNull();

  await mgr.runNow(task.id);

  const after = view(mgr, task.id);
  expect(after.threadId).toBeTruthy();
  const thread = db
    .select()
    .from(threads)
    .where(eq(threads.id, after.threadId as string))
    .get();
  expect(thread).toBeTruthy();
  expect((thread?.metadata as { scheduledTaskId?: string })?.scheduledTaskId).toBe(task.id);
});

test('runNow records a run; last-run + status derive from it', async () => {
  const { mgr } = setup(async () => ({ status: 'ok', messageId: 'msg-1' }));
  const task = mgr.create({ ...RECURRING });

  await mgr.runNow(task.id);

  const runs = mgr.listRuns(task.id);
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('ok');
  expect(runs[0].messageId).toBe('msg-1');

  const after = view(mgr, task.id);
  expect(after.lastStatus).toBe('ok');
  expect(after.consecutiveFailures).toBe(0);
  expect(after.lastRunAt).toBeInstanceOf(Date);
});

test('start() settles a run orphaned at running by a prior session', async () => {
  const { mgr, db } = setup();
  const task = mgr.create({ ...RECURRING });
  // A prior session inserted 'running' then died before the terminal write; the
  // later 'ok' proves reconcile only touches the orphan, not a finished run.
  db.insert(schema.scheduledTaskRuns)
    .values([
      { id: 'orphan', taskId: task.id, status: 'running', startedAt: new Date(START - 2000) },
      {
        id: 'done',
        taskId: task.id,
        status: 'ok',
        startedAt: new Date(START - 1000),
        finishedAt: new Date(START - 900),
      },
    ])
    .run();

  await mgr.start();

  const runs = mgr.listRuns(task.id);
  const orphan = runs.find((r) => r.id === 'orphan');
  expect(orphan?.status).toBe('interrupted');
  expect(orphan?.finishedAt).toBeInstanceOf(Date);
  expect(runs.find((r) => r.id === 'done')?.status).toBe('ok');
});

test('does not stack a second run while one is already in progress', async () => {
  let calls = 0;
  const { mgr } = setup(async () => {
    calls++;
    return { status: 'ok' };
  });
  const task = mgr.create({ ...RECURRING });

  // Two concurrent runs: the second must be skipped by the overlap guard.
  await Promise.all([mgr.runNow(task.id), mgr.runNow(task.id)]);

  expect(calls).toBe(1);
  expect(mgr.listRuns(task.id)).toHaveLength(1);
});

test('auto-pauses after five consecutive failures (derived from runs)', async () => {
  const { mgr } = setup(async () => ({ status: 'error', error: 'boom' }));
  const task = mgr.create({ ...RECURRING });

  for (let i = 0; i < 5; i++) await mgr.runNow(task.id);

  const after = view(mgr, task.id);
  expect(after.consecutiveFailures).toBe(5);
  expect(after.enabled).toBe(false);
  expect(after.lastStatus).toBe('error');
  // Disabled → next run no longer surfaced.
  expect(after.nextRunAt).toBeNull();
});

test('a successful run resets the trailing failure count', async () => {
  let fail = true;
  const { mgr } = setup(async () => (fail ? { status: 'error', error: 'x' } : { status: 'ok' }));
  const task = mgr.create({ ...RECURRING });

  await mgr.runNow(task.id);
  expect(view(mgr, task.id).consecutiveFailures).toBe(1);
  fail = false;
  await mgr.runNow(task.id);
  expect(view(mgr, task.id).consecutiveFailures).toBe(0);
});

test('catch-up fires a task missed while the app was closed (fire_once)', async () => {
  let calls = 0;
  const { mgr, nowRef } = setup(async () => {
    calls++;
    return { status: 'ok', messageId: `m${calls}` };
  });
  const task = mgr.create({ ...RECURRING });

  // Jump the clock past the derived next-run to simulate reopening after a miss.
  nowRef.v = (task.nextRunAt as Date).getTime() + 60_000;
  await mgr.start();

  expect(calls).toBe(1);
  expect(mgr.listRuns(task.id).some((r) => r.status === 'ok')).toBe(true);
});

test('catch-up skips a missed task under the skip policy', async () => {
  let calls = 0;
  const { mgr, nowRef } = setup(async () => {
    calls++;
    return { status: 'ok' };
  });
  const task = mgr.create({ ...RECURRING, catchUpPolicy: 'skip' });

  nowRef.v = (task.nextRunAt as Date).getTime() + 60_000;
  await mgr.start();

  expect(calls).toBe(0);
  expect(mgr.listRuns(task.id)).toHaveLength(0);
});

test('a once task disables itself (keeping history) after a scheduled fire', async () => {
  const { mgr, nowRef } = setup(async () => ({ status: 'ok', messageId: 'once-1' }));
  const runAt = new Date(START + 60_000);
  const task = mgr.create({
    title: 'One-off',
    prompt: 'do it',
    kind: 'once',
    runAt,
    timezone: 'UTC',
  });
  expect((task.nextRunAt as Date).getTime()).toBe(runAt.getTime());

  // Reopen after runAt → catch-up fires it once via the scheduled path.
  nowRef.v = runAt.getTime() + 60_000;
  await mgr.start();

  const after = view(mgr, task.id);
  expect(after.enabled).toBe(false);
  expect(after.nextRunAt).toBeNull();
  expect(mgr.listRuns(task.id)).toHaveLength(1);
});

test('update reschedules and recomputes next run; remove deletes task + runs', async () => {
  const { mgr } = setup();
  const task = mgr.create({ ...RECURRING });
  await mgr.runNow(task.id);
  expect(mgr.listRuns(task.id)).toHaveLength(1);

  const updated = mgr.update(task.id, { cronExpr: '0 12 * * *' });
  expect(updated.cronExpr).toBe('0 12 * * *');
  expect(updated.nextRunAt).toBeInstanceOf(Date);

  mgr.remove(task.id);
  expect(mgr.getView(task.id)).toBeNull();
  expect(mgr.listRuns(task.id)).toHaveLength(0);
});

test('disabling a task hides its next run; re-enabling surfaces it again', () => {
  const { mgr } = setup();
  const task = mgr.create({ ...RECURRING });

  const off = mgr.setEnabled(task.id, false);
  expect(off.enabled).toBe(false);
  expect(off.nextRunAt).toBeNull();

  const on = mgr.setEnabled(task.id, true);
  expect(on.enabled).toBe(true);
  expect(on.nextRunAt).toBeInstanceOf(Date);
});
