import { Database } from 'bun:sqlite';
import { expect, mock, test } from 'bun:test';
import type { Runner, RunOutcome } from '@main/agent/runtime/runner';
import type { Db } from '@main/db';
import type { ScheduledTask } from '@main/db/schema';
import * as schema from '@main/db/schema';
import type { InteractionRequest } from '@shared/interactions';
import type { AgentSessionEvent } from '@shared/protocol';
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

const request = (id: string): InteractionRequest => ({
  id,
  runId: 'r1',
  kind: 'approval',
  toolCall: { type: 'toolCall', id: `call-${id}`, name: 'bash', arguments: {} },
  createdAt: 1,
});

function fakeRunner() {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  let settle!: (outcome: RunOutcome) => void;
  const settled = new Promise<RunOutcome>((resolve) => {
    settle = resolve;
  });
  const start = mock(() => ({
    runId: 'r1',
    settled,
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }));
  return {
    runner: { start } as unknown as Runner,
    start,
    listeners,
    emit: (event: AgentSessionEvent) => {
      for (const listener of listeners) listener(event);
    },
    settle,
  };
}

function suspensionBlocker() {
  const releases: Array<ReturnType<typeof mock>> = [];
  const block = mock(() => {
    const release = mock(() => {});
    releases.push(release);
    return release;
  });
  return { block, releases };
}

test('a run waiting on the user stays running while the machine may sleep', async () => {
  const runner = fakeRunner();
  const suspension = suspensionBlocker();
  let finished = false;
  const running = runScheduledTask(
    {
      db: makeDb(),
      runner: runner.runner,
      defaultModel: () => null,
      blockSuspension: suspension.block,
    },
    task,
  ).then((result) => {
    finished = true;
    return result;
  });
  expect(suspension.block).toHaveBeenCalledTimes(1);

  runner.emit({ type: 'interaction_requested', request: request('a') });
  expect(suspension.releases[0]).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(finished).toBe(false);

  runner.emit({
    type: 'interaction_resolved',
    request: request('a'),
    outcome: { kind: 'approved' },
  });
  expect(suspension.block).toHaveBeenCalledTimes(2);

  runner.settle({ runId: 'r1', status: 'ok', messageId: 'r1' });
  expect(await running).toEqual({ status: 'ok', error: undefined, messageId: 'r1' });
  expect(suspension.releases[1]).toHaveBeenCalledTimes(1);
  expect(runner.listeners.size).toBe(0);
  expect(runner.start).toHaveBeenCalledTimes(1);
});

test('the machine stays free until every waiting request is answered', async () => {
  const runner = fakeRunner();
  const suspension = suspensionBlocker();
  const running = runScheduledTask(
    {
      db: makeDb(),
      runner: runner.runner,
      defaultModel: () => null,
      blockSuspension: suspension.block,
    },
    task,
  );
  runner.emit({ type: 'interaction_requested', request: request('a') });
  runner.emit({ type: 'interaction_requested', request: request('b') });
  runner.emit({
    type: 'interaction_resolved',
    request: request('a'),
    outcome: { kind: 'approved' },
  });
  expect(suspension.block).toHaveBeenCalledTimes(1);
  runner.emit({
    type: 'interaction_resolved',
    request: request('b'),
    outcome: { kind: 'approved' },
  });
  expect(suspension.block).toHaveBeenCalledTimes(2);
  runner.settle({ runId: 'r1', status: 'ok' });
  await running;
});

test('a run that ends while waiting does not block suspension again', async () => {
  const runner = fakeRunner();
  const suspension = suspensionBlocker();
  const running = runScheduledTask(
    {
      db: makeDb(),
      runner: runner.runner,
      defaultModel: () => null,
      blockSuspension: suspension.block,
    },
    task,
  );
  runner.emit({ type: 'interaction_requested', request: request('a') });
  runner.settle({ runId: 'r1', status: 'ok' });
  await running;
  expect(suspension.block).toHaveBeenCalledTimes(1);
  expect(suspension.releases[0]).toHaveBeenCalledTimes(1);
});

test('a run the runner refuses still lets the machine sleep', async () => {
  const suspension = suspensionBlocker();
  const runner = {
    start: () => {
      throw new Error('Model is not registered');
    },
  } as unknown as Runner;
  const result = await runScheduledTask(
    { db: makeDb(), runner, defaultModel: () => null, blockSuspension: suspension.block },
    task,
  );
  expect(result).toEqual({ status: 'error', error: 'Model is not registered' });
  expect(suspension.releases[0]).toHaveBeenCalledTimes(1);
});
