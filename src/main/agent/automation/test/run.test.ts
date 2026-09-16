import { Database } from 'bun:sqlite';
import { expect, mock, test } from 'bun:test';
import type { Runner, RunOutcome } from '@main/agent/runtime/runner';
import type { Db } from '@main/db';
import type { ScheduledTask } from '@main/db/schema';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runScheduledTask } from '../run';

function makeDb(): Db {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE scheduled_task_runs (
    id text PRIMARY KEY NOT NULL, task_id text NOT NULL, message_id text, status text NOT NULL,
    error text, started_at integer NOT NULL, finished_at integer)`);
  return drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
}

const task = {
  id: 'task-1',
  title: 'Nightly check',
  prompt: 'Check the build.',
  threadId: 't1',
  providerId: 'p',
  modelId: 'm',
  permissionMode: 'default',
} as ScheduledTask;

function fakeRunner() {
  let settle!: (outcome: RunOutcome) => void;
  const settled = new Promise<RunOutcome>((resolve) => {
    settle = resolve;
  });
  const start = mock(() => ({ runId: 'r1', settled }));
  return { runner: { start } as unknown as Runner, start, settle };
}

test('a scheduled run waits for the run it started and reports its outcome', async () => {
  const runner = fakeRunner();
  let finished = false;
  const running = runScheduledTask(
    { db: makeDb(), runner: runner.runner, defaultModel: () => null },
    task,
  ).then((result) => {
    finished = true;
    return result;
  });
  await Promise.resolve();
  expect(finished).toBe(false);

  runner.settle({ status: 'ok', messageId: 'r1' });
  expect(await running).toEqual({ status: 'ok', messageId: 'r1' });
  expect(runner.start).toHaveBeenCalledTimes(1);
});

test('a run that fails carries its error back to the task', async () => {
  const runner = fakeRunner();
  const running = runScheduledTask(
    { db: makeDb(), runner: runner.runner, defaultModel: () => null },
    task,
  );
  runner.settle({ status: 'error', error: 'the model refused' });
  expect(await running).toEqual({ status: 'error', error: 'the model refused' });
});

test('a run the runner refuses is reported as an error', async () => {
  const runner = {
    start: () => {
      throw new Error('Model is not registered');
    },
  } as unknown as Runner;
  const result = await runScheduledTask({ db: makeDb(), runner, defaultModel: () => null }, task);
  expect(result).toEqual({ status: 'error', error: 'Model is not registered' });
});

test('a task with no model never reaches the runner', async () => {
  const runner = fakeRunner();
  const result = await runScheduledTask(
    { db: makeDb(), runner: runner.runner, defaultModel: () => null },
    { ...task, providerId: null, modelId: null } as ScheduledTask,
  );
  expect(result).toEqual({
    status: 'error',
    error: 'No model configured for this scheduled task.',
  });
  expect(runner.start).not.toHaveBeenCalled();
});
