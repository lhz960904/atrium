import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, MessageSquareText, Pause, Play, Trash2, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeCron, type ScheduledRun, type ScheduledTask } from '../../lib/schedule-format';
import { formatDateTime, timeAgo } from '../../lib/time';
import { trpc } from '../../lib/trpc';
import { toast } from '../../state/toast-store';

/** A label/value row in the Status and Details blocks. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-fg-tertiary text-sm">{label}</span>
      <span className="min-w-0 truncate text-fg-secondary text-sm">{children}</span>
    </div>
  );
}

function RunRow({
  run,
  title,
  onOpen,
}: {
  run: ScheduledRun;
  title: string;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const Icon = run.status === 'error' ? XCircle : run.status === 'ok' ? CheckCircle2 : Play;
  const color =
    run.status === 'error'
      ? 'text-danger'
      : run.status === 'ok'
        ? 'text-success'
        : 'text-fg-tertiary';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      title={run.error ?? undefined}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left enabled:hover:bg-elevated disabled:cursor-default"
    >
      <Icon className={`size-4 shrink-0 ${color}`} />
      <span className="min-w-0 flex-1 truncate text-fg-secondary text-sm">
        {run.status === 'error' && run.error ? run.error : title}
      </span>
      <span className="shrink-0 text-fg-disabled text-xs">{timeAgo(run.startedAt)}</span>
    </button>
  );
}

/**
 * The right-hand detail panel: prompt, status, schedule details, and run
 * history, plus the Run now / pause / delete / open-conversation actions. Its
 * mutations live here (not the parent list) since they act on this one task.
 */
export function TaskDetail({
  task,
  lang,
  onClose,
  onDeleted,
}: {
  task: ScheduledTask;
  lang: 'en' | 'zh';
  onClose: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const runs = trpc.scheduled.runs.useQuery({ id: task.id });
  const projects = trpc.projects.list.useQuery();

  const runNow = trpc.scheduled.runNow.useMutation({
    onSuccess: () => {
      toast.success({ key: 'scheduled.startedToast' });
      utils.scheduled.runs.invalidate({ id: task.id });
    },
  });
  const toggle = trpc.scheduled.setEnabled.useMutation({
    onSuccess: () => utils.scheduled.list.invalidate(),
  });
  const del = trpc.scheduled.delete.useMutation({
    onSuccess: () => {
      utils.scheduled.list.invalidate();
      onDeleted();
    },
  });

  const openThread = task.threadId
    ? () => navigate({ to: '/chat/$threadId', params: { threadId: task.threadId as string } })
    : undefined;

  const schedule =
    task.kind === 'recurring' && task.cronExpr
      ? describeCron(task.cronExpr, lang)
      : task.runAt
        ? formatDateTime(task.runAt, lang)
        : '—';
  const projectName = task.projectId
    ? (projects.data?.find((p) => p.id === task.projectId)?.name ?? task.projectId)
    : t('scheduled.noProject');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Pinned header doubles as the window-drag strip; the controls opt out. */}
      <header className="app-drag flex shrink-0 items-start gap-3 px-6 pt-9 pb-1">
        <IconBtn title={t('common.close')} onClick={onClose}>
          <X className="size-4" />
        </IconBtn>
        <h2 className="mt-0.5 min-w-0 flex-1 font-semibold text-fg-primary text-lg leading-snug">
          {task.title}
        </h2>
        <div className="app-no-drag flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => runNow.mutate({ id: task.id })}
            disabled={runNow.isLoading}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 font-medium text-fg-on-accent text-xs hover:bg-accent-hover disabled:opacity-40"
          >
            <Play className="size-3.5" />
            {t('scheduled.runNow')}
          </button>
          <IconBtn
            title={task.enabled ? t('scheduled.pause') : t('scheduled.resume')}
            onClick={() => toggle.mutate({ id: task.id, enabled: !task.enabled })}
          >
            {task.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconBtn>
          {openThread && (
            <IconBtn title={t('scheduled.openThread')} onClick={openThread}>
              <MessageSquareText className="size-4" />
            </IconBtn>
          )}
          <IconBtn
            title={t('scheduled.delete')}
            danger
            onClick={() => {
              if (window.confirm(t('scheduled.deleteConfirm'))) del.mutate({ id: task.id });
            }}
          >
            <Trash2 className="size-4" />
          </IconBtn>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <p className="mt-2 whitespace-pre-wrap text-fg-secondary text-sm leading-relaxed">
          {task.prompt}
        </p>

        <Block title={t('scheduled.status')}>
          <Field label={t('scheduled.status')}>
            <StatusBadge enabled={task.enabled} t={t} />
          </Field>
          <Field label={t('scheduled.nextRun')}>
            {task.nextRunAt ? formatDateTime(task.nextRunAt, lang) : '—'}
          </Field>
          <Field label={t('scheduled.lastRan')}>
            {task.lastRunAt ? formatDateTime(task.lastRunAt, lang) : t('scheduled.never')}
          </Field>
        </Block>

        <Block title={t('scheduled.details')}>
          <Field label={t('scheduled.runsIn')}>{t('scheduled.local')}</Field>
          <Field label={t('scheduled.project')}>{projectName}</Field>
          <Field label={t('scheduled.repeats')}>{schedule}</Field>
          <Field label={t('scheduled.model')}>{task.modelId ?? t('scheduled.defaultModel')}</Field>
        </Block>

        <Block title={t('scheduled.previousRuns')}>
          {runs.data && runs.data.length > 0 ? (
            <div className="flex flex-col">
              {runs.data.map((run) => (
                <RunRow key={run.id} run={run} title={task.title} onOpen={openThread} />
              ))}
            </div>
          ) : (
            <p className="py-2 text-fg-tertiary text-sm">{t('scheduled.noRuns')}</p>
          )}
        </Block>
      </div>
    </div>
  );
}

function IconBtn({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`app-no-drag rounded-md p-1.5 text-fg-tertiary hover:bg-surface-strong ${
        danger ? 'hover:text-danger' : 'hover:text-fg-primary'
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  enabled,
  t,
}: {
  enabled: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${enabled ? 'bg-success' : 'bg-fg-disabled'}`} />
      {enabled ? t('scheduled.statusActive') : t('scheduled.statusPaused')}
    </span>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="mt-6">
      <h3 className="mb-1 font-medium text-fg-tertiary text-xs uppercase tracking-wider">
        {title}
      </h3>
      <div className="divide-y divide-border-default border-border-default border-t">
        {children}
      </div>
    </section>
  );
}
