import { tool } from 'ai';
import { z } from 'zod';
import { scheduledManager } from '../../scheduled';
import { isRecurringCron } from '../../scheduled/cron';

const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const CREATE_DESCRIPTION = `Schedule a prompt to run automatically — on a recurring cron schedule, or once at a future time. Use when the user wants a reminder, a recurring briefing/monitor, or anything run on a schedule ("every weekday at 8am summarize AI news", "remind me in 30 minutes", "check X every hour").

The scheduled prompt runs later in its OWN conversation with no memory of this chat, so write "prompt" as a fully self-contained instruction. Each run appends to that task's conversation and raises a desktop notification.

Provide exactly one of: cron (recurring), at (one-time absolute), or in_minutes (one-time relative). Times are the user's local time.`;

/** Create a scheduled task from a chat ("every weekday 8am…" → cron). */
export const scheduleCreateTool = () =>
  tool({
    description: CREATE_DESCRIPTION,
    inputSchema: z.object({
      title: z.string().min(1).describe('Short title shown in the Scheduled list.'),
      prompt: z
        .string()
        .min(1)
        .describe(
          'Self-contained instruction run on each fire; it cannot see the current conversation.',
        ),
      cron: z
        .string()
        .optional()
        .describe('5-field cron for a recurring task, e.g. "0 8 * * 1-5" = 08:00 on weekdays.'),
      at: z
        .string()
        .optional()
        .describe(
          'ISO 8601 local datetime for a one-time run, e.g. "2026-07-03T15:00" (for "at 3pm", "tomorrow 9am").',
        ),
      in_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Minutes from now for a one-time run (for "in 10 minutes", "in 2 hours" = 120).'),
      timezone: z
        .string()
        .optional()
        .describe('IANA timezone, e.g. "Asia/Shanghai". Defaults to the system timezone.'),
    }),
    execute: async ({ title, prompt, cron, at, in_minutes, timezone }) => {
      if ([cron, at, in_minutes].filter((v) => v != null).length !== 1) {
        throw new Error('Provide exactly one of cron, at, or in_minutes.');
      }
      const tz = timezone?.trim() || systemTimeZone();
      if (cron != null) {
        if (!isRecurringCron(cron)) throw new Error(`Invalid 5-field cron: "${cron}".`);
        const task = scheduledManager.create({
          title,
          prompt,
          kind: 'recurring',
          cronExpr: cron.trim(),
          timezone: tz,
        });
        const next = scheduledManager.getView(task.id)?.nextRunAt;
        return `Created recurring task "${title}" (id ${task.id})${next ? `, next run ${next.toISOString()}` : ''}. Manage it in Scheduled.`;
      }
      const runAt =
        in_minutes != null ? new Date(Date.now() + in_minutes * 60_000) : new Date(at as string);
      if (Number.isNaN(runAt.getTime())) throw new Error(`Invalid datetime: "${at}".`);
      if (runAt.getTime() <= Date.now()) throw new Error('The run time must be in the future.');
      const task = scheduledManager.create({ title, prompt, kind: 'once', runAt, timezone: tz });
      return `Created one-time task "${title}" (id ${task.id}) for ${runAt.toISOString()}. Manage it in Scheduled.`;
    },
  });

/** List the user's scheduled tasks so the model can reference or cancel them. */
export const scheduleListTool = () =>
  tool({
    description:
      "List the user's scheduled tasks (id, title, schedule, enabled, next run). Use before cancelling, or when asked what's scheduled.",
    inputSchema: z.object({}),
    execute: async () => {
      const tasks = scheduledManager.listViews();
      if (tasks.length === 0) return 'No scheduled tasks.';
      return tasks
        .map((t) => {
          const when = t.kind === 'recurring' ? t.cronExpr : t.runAt?.toISOString();
          const next = t.nextRunAt ? `, next ${t.nextRunAt.toISOString()}` : '';
          return `- ${t.id} · "${t.title}" · ${t.kind} ${when} (${t.timezone}) · ${t.enabled ? 'enabled' : 'disabled'}${next}`;
        })
        .join('\n');
    },
  });

/** Cancel (delete) a scheduled task by id. */
export const scheduleCancelTool = () =>
  tool({
    description: 'Cancel (delete) a scheduled task by id. Get the id from schedule_list first.',
    inputSchema: z.object({
      id: z.string().min(1).describe('The scheduled task id (from schedule_list).'),
    }),
    execute: async ({ id }) => {
      const task = scheduledManager.getView(id);
      if (!task) throw new Error(`No scheduled task with id "${id}".`);
      scheduledManager.remove(id);
      return `Cancelled scheduled task "${task.title}" (id ${id}).`;
    },
  });
