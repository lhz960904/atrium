import { randomUUID } from 'node:crypto';
import type { PermissionMode } from '@shared/permissions';
import type { SelectedModel } from '@shared/settings';
import { Cron } from 'croner';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db';
import type { ScheduledTask, ScheduledTaskRun } from '../../db/schema';
import { scheduledTaskRuns, scheduledTasks, threads } from '../../db/schema';
import { createLogger } from '../../log';
import { computeNextRun } from './cron';
import { type RunEndpoint, runScheduledTask, type ScheduledRunResult } from './run';

const log = createLogger('scheduled');

/** Disable a task after this many back-to-back failed runs. */
const FAILURE_THRESHOLD = 5;

export type ScheduledManagerDeps = {
  db: Db;
  endpoint: RunEndpoint;
  defaultModel: () => SelectedModel | null;
  /** Fired after each run settles, for the notification layer. */
  onComplete?: (task: ScheduledTask, run: ScheduledTaskRun) => void;
  /** Injectable runner (tests); defaults to the real headless runner. */
  run?: (task: ScheduledTask) => Promise<ScheduledRunResult>;
  /** Injectable clock (tests). */
  now?: () => number;
};

export type CreateScheduledTaskInput = {
  title: string;
  prompt: string;
  kind: 'recurring' | 'once';
  cronExpr?: string | null;
  runAt?: Date | null;
  timezone: string;
  enabled?: boolean;
  projectId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  permissionMode?: PermissionMode;
  catchUpPolicy?: 'fire_once' | 'skip';
};

export type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput>;

/**
 * A task definition plus its derived run state — the shape the tRPC router and
 * UI consume. The derived fields are computed on read (never stored): `nextRunAt`
 * from the cron expression, the rest from the task's run history.
 */
export type ScheduledTaskView = ScheduledTask & {
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: ScheduledTaskRun['status'] | null;
  consecutiveFailures: number;
};

/**
 * Owns the lifecycle of scheduled tasks: it is the single write path, so the
 * in-memory croner jobs never drift from the DB. Every mutation (from the tRPC
 * router or an agent tool) goes through here, and each firing appends a turn to
 * the task's bound thread. Construct once as `scheduledManager`, `init()` it
 * with the app's db + chat endpoint at boot, then `start()`.
 */
export class ScheduledTaskManager {
  private deps!: ScheduledManagerDeps;
  private readonly jobs = new Map<string, Cron>();

  init(deps: ScheduledManagerDeps): void {
    this.deps = deps;
  }

  private get db(): Db {
    if (!this.deps) throw new Error('ScheduledTaskManager not initialized');
    return this.deps.db;
  }

  private nowMs(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private runner(task: ScheduledTask): Promise<ScheduledRunResult> {
    return this.deps.run
      ? this.deps.run(task)
      : runScheduledTask(
          { db: this.db, endpoint: this.deps.endpoint, defaultModel: this.deps.defaultModel },
          task,
        );
  }

  // ── reads (views expose the derived run state) ──────────────────────────

  listViews(): ScheduledTaskView[] {
    return this.list().map((t) => this.toView(t));
  }

  getView(id: string): ScheduledTaskView | null {
    const task = this.get(id);
    return task ? this.toView(task) : null;
  }

  listRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
    return this.db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.taskId, taskId))
      .orderBy(desc(scheduledTaskRuns.startedAt), desc(sql`rowid`))
      .limit(limit)
      .all();
  }

  // ── writes (DB + croner in lockstep) ────────────────────────────────────

  create(input: CreateScheduledTaskInput): ScheduledTaskView {
    const id = randomUUID();
    const now = new Date(this.nowMs());
    // The bound thread carries a back-reference so the sidebar can tell a
    // task's conversation apart from ordinary chats.
    const threadId = randomUUID();
    this.db
      .insert(threads)
      .values({
        id: threadId,
        title: input.title,
        projectId: input.projectId ?? null,
        metadata: { scheduledTaskId: id },
      })
      .run();

    this.db
      .insert(scheduledTasks)
      .values({
        id,
        threadId,
        title: input.title,
        prompt: input.prompt,
        kind: input.kind,
        cronExpr: input.cronExpr ?? null,
        runAt: input.runAt ?? null,
        timezone: input.timezone,
        enabled: input.enabled ?? true,
        projectId: input.projectId ?? null,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        permissionMode: input.permissionMode ?? 'full-access',
        catchUpPolicy: input.catchUpPolicy ?? 'fire_once',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const task = this.get(id);
    if (!task) throw new Error('scheduled task vanished after insert');
    this.schedule(task);
    return this.toView(task);
  }

  update(id: string, patch: UpdateScheduledTaskInput): ScheduledTaskView {
    const set: Record<string, unknown> = { updatedAt: new Date(this.nowMs()) };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    this.db
      .update(scheduledTasks)
      .set(set as Partial<typeof scheduledTasks.$inferInsert>)
      .where(eq(scheduledTasks.id, id))
      .run();

    const task = this.get(id);
    if (!task) throw new Error(`scheduled task ${id} not found`);
    // Re-register: schedule fields or the enabled flag may have changed.
    this.schedule(task);
    return this.toView(task);
  }

  setEnabled(id: string, enabled: boolean): ScheduledTaskView {
    return this.update(id, { enabled });
  }

  remove(id: string): void {
    this.unschedule(id);
    // The bound thread is left intact — the user may still want the produced
    // conversations. Runs cascade-delete with the task row.
    this.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run();
  }

  /** Fire immediately, independent of the schedule (detail-panel "Run now"). */
  runNow(id: string): Promise<void> {
    return this.fire(id, { manual: true });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /** Schedule every enabled task and catch up anything missed while closed.
   *  Returns the catch-up promise so callers (tests) can await the missed runs;
   *  the boot path ignores it (catch-up proceeds in the background). */
  start(): Promise<void> {
    const now = this.nowMs();
    const missed: string[] = [];
    for (const task of this.list()) {
      if (!task.enabled) continue;
      this.schedule(task);
      // Missed iff the next occurrence *after we last ran* (or after creation,
      // if never) is already in the past — i.e. a due firing slipped by while
      // the app was closed. Coalesces many missed occurrences into one.
      const reference = this.latestRun(task.id)?.startedAt ?? task.createdAt;
      const due = computeNextRun(task, reference);
      if (due && due.getTime() <= now) missed.push(task.id);
    }
    return this.catchUp(missed);
  }

  dispose(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private list(): ScheduledTask[] {
    return this.db.select().from(scheduledTasks).orderBy(desc(scheduledTasks.updatedAt)).all();
  }

  private get(id: string): ScheduledTask | null {
    return this.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get() ?? null;
  }

  private latestRun(taskId: string): ScheduledTaskRun | null {
    return (
      this.db
        .select()
        .from(scheduledTaskRuns)
        .where(eq(scheduledTaskRuns.taskId, taskId))
        .orderBy(desc(scheduledTaskRuns.startedAt), desc(sql`rowid`))
        .limit(1)
        .get() ?? null
    );
  }

  /** Count of the most recent runs that failed back-to-back (stops at the first
   *  non-error). Only needs to reach the threshold, so it reads that many rows. */
  private trailingFailures(taskId: string): number {
    const recent = this.db
      .select({ status: scheduledTaskRuns.status })
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.taskId, taskId))
      .orderBy(desc(scheduledTaskRuns.startedAt), desc(sql`rowid`))
      .limit(FAILURE_THRESHOLD)
      .all();
    let n = 0;
    for (const r of recent) {
      if (r.status !== 'error') break;
      n++;
    }
    return n;
  }

  private toView(task: ScheduledTask): ScheduledTaskView {
    const last = this.latestRun(task.id);
    return {
      ...task,
      nextRunAt: task.enabled ? computeNextRun(task, new Date(this.nowMs())) : null,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      consecutiveFailures: this.trailingFailures(task.id),
    };
  }

  private schedule(task: ScheduledTask): void {
    this.unschedule(task.id);
    if (!task.enabled) return;
    const fire = (): void => {
      void this.fire(task.id, { manual: false });
    };
    // protect skips a fire if the previous one is still running; catch keeps a
    // throw inside croner from crashing the timer (fire() also guards itself).
    const opts = { timezone: task.timezone, protect: true, catch: true } as const;
    try {
      if (task.kind === 'once') {
        if (!task.runAt || task.runAt.getTime() <= this.nowMs()) return;
        this.jobs.set(task.id, new Cron(task.runAt, opts, fire));
      } else {
        if (!task.cronExpr) return;
        this.jobs.set(task.id, new Cron(task.cronExpr, opts, fire));
      }
    } catch (err) {
      log.error(`failed to schedule task ${task.id}`, err);
    }
  }

  private unschedule(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private async catchUp(ids: string[]): Promise<void> {
    for (const id of ids) {
      const task = this.get(id);
      if (!task?.enabled) continue;
      // 'skip' just leaves the future occurrence croner already scheduled;
      // 'fire_once' coalesces every missed occurrence into a single run.
      if (task.catchUpPolicy === 'skip') continue;
      log.info(`catch-up firing missed task ${id}`);
      await this.fire(id, { manual: false });
    }
  }

  private async fire(id: string, { manual }: { manual: boolean }): Promise<void> {
    const task = this.get(id);
    if (!task) return;

    const runId = randomUUID();
    const startedAt = new Date(this.nowMs());
    this.db
      .insert(scheduledTaskRuns)
      .values({ id: runId, taskId: id, status: 'running', messageId: null, startedAt })
      .run();

    let result: ScheduledRunResult;
    try {
      result = await this.runner(task);
    } catch (err) {
      log.error(`scheduled task ${id} threw`, err);
      result = { status: 'error', error: String(err) };
    }

    this.db
      .update(scheduledTaskRuns)
      .set({
        status: result.status,
        messageId: result.messageId ?? null,
        error: result.error ?? null,
        finishedAt: new Date(this.nowMs()),
      })
      .where(eq(scheduledTaskRuns.id, runId))
      .run();

    // The only task-row state is `enabled`: a one-shot consumes itself, and a
    // recurring task auto-pauses once it has failed enough times in a row (both
    // derived from the run just recorded).
    if (task.kind === 'once' && !manual) {
      this.disable(id);
    } else if (this.trailingFailures(id) >= FAILURE_THRESHOLD) {
      this.disable(id);
      log.warn(`auto-paused task ${id} after ${FAILURE_THRESHOLD} consecutive failures`);
    }

    const run = this.db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.id, runId))
      .get();
    if (run) this.deps.onComplete?.(this.get(id) ?? task, run);
  }

  private disable(id: string): void {
    this.db
      .update(scheduledTasks)
      .set({ enabled: false, updatedAt: new Date(this.nowMs()) })
      .where(eq(scheduledTasks.id, id))
      .run();
    this.unschedule(id);
  }
}

/** App-wide singleton; `init()` + `start()` at boot (see agent/scheduled/index.ts). */
export const scheduledManager = new ScheduledTaskManager();
