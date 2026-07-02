import { tool } from 'ai';
import { z } from 'zod';
import type { UpdateScheduledTaskInput } from '../../scheduled';
import { scheduledManager } from '../../scheduled';
import { isRecurringCron } from '../../scheduled/cron';

const systemTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const CREATE_DESCRIPTION = `Schedule a prompt to run automatically — on a recurring cron schedule, or once at a future time. Use when the user wants a reminder, a recurring briefing/monitor, or anything run on a schedule ("every weekday at 8am summarize AI news", "remind me in 30 minutes", "check X every hour").

The task fires later in its OWN conversation with no memory of this chat, so write the fields for that moment:
- title: short and imperative, verb first; do NOT include the date or time.
- prompt: the task written as a self-contained message from the user to you; do NOT include any scheduling info (the schedule fields own that).

Provide exactly one of cron (recurring) or at (one-time). Times are the user's local time — resolve relative requests ("in 30 minutes", "tonight") into an absolute "at" using the current time from context. Lean toward NOT proactively suggesting tasks; schedule only when asked.`;

/** Create a scheduled task from a chat ("every weekday 8am…" → cron). */
export const scheduleCreateTool = () =>
  tool({
    description: CREATE_DESCRIPTION,
    inputSchema: z.object({
      title: z
        .string()
        .min(1)
        .describe(
          'Short imperative title (verb first), no date/time. Shown in the Scheduled list.',
        ),
      prompt: z
        .string()
        .min(1)
        .describe(
          'The task as a self-contained message from the user to you, with no scheduling info; it cannot see this conversation.',
        ),
      cron: z
        .string()
        .optional()
        .describe('5-field cron for a recurring task, e.g. "0 8 * * 1-5" = 08:00 on weekdays.'),
      at: z
        .string()
        .optional()
        .describe(
          'ISO 8601 local datetime for a one-time run, e.g. "2026-07-03T15:00". Compute relative times ("in 30 min") from the current time.',
        ),
      timezone: z
        .string()
        .optional()
        .describe('IANA timezone, e.g. "Asia/Shanghai". Defaults to the system timezone.'),
    }),
    execute: async ({ title, prompt, cron, at, timezone }) => {
      if ((cron == null) === (at == null)) {
        throw new Error('Provide exactly one of cron (recurring) or at (one-time).');
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
      const runAt = new Date(at as string);
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

/** Update an existing scheduled task from a chat ("change it to 9am", "pause it"). */
export const scheduleUpdateTool = () =>
  tool({
    description:
      'Update an existing scheduled task — its schedule, prompt, title, or enabled state. Get the id from schedule_list first, and pass only the fields to change. Use cron for recurring or at (ISO datetime) for one-time; enabled:false pauses, true resumes.',
    inputSchema: z.object({
      id: z.string().min(1).describe('The scheduled task id (from schedule_list).'),
      title: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      cron: z.string().optional().describe('New 5-field cron (switches to recurring).'),
      at: z.string().optional().describe('New ISO 8601 datetime (switches to one-time).'),
      enabled: z.boolean().optional().describe('false pauses the task, true resumes it.'),
      timezone: z.string().optional(),
    }),
    execute: async ({ id, title, prompt, cron, at, enabled, timezone }) => {
      if (!scheduledManager.getView(id)) throw new Error(`No scheduled task with id "${id}".`);
      const patch: UpdateScheduledTaskInput = {};
      if (title !== undefined) patch.title = title;
      if (prompt !== undefined) patch.prompt = prompt;
      if (enabled !== undefined) patch.enabled = enabled;
      if (timezone !== undefined) patch.timezone = timezone;
      if (cron !== undefined) {
        if (!isRecurringCron(cron)) throw new Error(`Invalid 5-field cron: "${cron}".`);
        patch.kind = 'recurring';
        patch.cronExpr = cron.trim();
        patch.runAt = null;
      } else if (at !== undefined) {
        const runAt = new Date(at);
        if (Number.isNaN(runAt.getTime())) throw new Error(`Invalid datetime: "${at}".`);
        if (runAt.getTime() <= Date.now()) throw new Error('The run time must be in the future.');
        patch.kind = 'once';
        patch.runAt = runAt;
        patch.cronExpr = null;
      }
      const view = scheduledManager.update(id, patch);
      return `Updated scheduled task "${view.title}" (id ${id}).`;
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
