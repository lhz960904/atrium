import { useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2,
  CircleSlash,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import type { ScheduledRun, ScheduledTask } from '../../lib/schedule-format';
import { formatDateTime } from '../../lib/time';
import { trpc } from '../../lib/trpc';
import { deriveGroups } from '../../lib/use-chat-model';
import { toast } from '../../state/toast-store';
import { ScheduleEditor, type SchedulePatch } from './ScheduleEditor';

/** Distinct providerId/modelId can't collide in one option value. */
const SEP = '\u001f';

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 py-1">
      <span className="shrink-0 text-fg-tertiary text-sm">{label}</span>
      {children}
    </div>
  );
}

// A run in progress spins; the rest are terminal outcomes with a static glyph.
// `interrupted` is neutral (muted, not a red failure) — the run was cut short by
// an app close/kill, not by the task itself erroring.
const RUN_STATUS = {
  running: { Icon: LoaderCircle, color: 'text-accent', spin: true },
  ok: { Icon: CheckCircle2, color: 'text-success', spin: false },
  error: { Icon: XCircle, color: 'text-danger', spin: false },
  skipped: { Icon: Play, color: 'text-fg-tertiary', spin: false },
  interrupted: { Icon: CircleSlash, color: 'text-fg-tertiary', spin: false },
} as const;

function RunRow({
  run,
  title,
  lang,
  onOpen,
}: {
  run: ScheduledRun;
  title: string;
  lang: 'en' | 'zh';
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  const { Icon, color, spin } = RUN_STATUS[run.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      title={run.error ?? undefined}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left enabled:hover:bg-elevated disabled:cursor-default"
    >
      <Icon className={`size-4 shrink-0 ${color} ${spin ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1 truncate text-fg-secondary text-sm">
        {run.status === 'error' && run.error ? run.error : title}
      </span>
      <span className="shrink-0 text-fg-disabled text-xs">
        {formatDateTime(run.startedAt, lang)}
      </span>
    </button>
  );
}

/**
 * The right-hand detail panel: editable title / prompt / schedule / project /
 * model (autosaved), read-only status + run history, and the Run now / pause /
 * delete / open-conversation actions. Its mutations live here since they act on
 * this one task.
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
  // While a run is in flight its row shows a spinner; poll so it flips to the
  // terminal ok/error glyph on finish (a background firing won't invalidate this).
  const runs = trpc.scheduled.runs.useQuery(
    { id: task.id },
    { refetchInterval: (data) => (data?.some((r) => r.status === 'running') ? 2000 : false) },
  );
  const projects = trpc.projects.list.useQuery();
  const providers = trpc.providers.list.useQuery();

  const refreshRuns = (): void => {
    utils.scheduled.runs.invalidate({ id: task.id });
  };
  const runNow = trpc.scheduled.runNow.useMutation({
    onSuccess: (data) => {
      if (data.started) {
        toast.success({ key: 'scheduled.startedToast' });
        refreshRuns();
      } else {
        toast.info({ key: 'scheduled.alreadyRunningToast' });
      }
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
  const update = trpc.scheduled.update.useMutation({
    onSuccess: () => utils.scheduled.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const save = (patch: Record<string, unknown>): void => {
    update.mutate({ id: task.id, ...patch });
  };

  // Local edit state for the free-text fields; committed on blur.
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);

  const openThread = task.threadId
    ? () => navigate({ to: '/chat/$threadId', params: { threadId: task.threadId as string } })
    : undefined;

  const projectOptions = [
    { value: 'none', label: t('scheduled.noProject') },
    ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];
  const modelOptions = [
    { value: 'default', label: t('scheduled.defaultModel') },
    ...deriveGroups(providers.data ?? []).flatMap((g) =>
      g.models.map((m) => ({
        value: `${g.providerId}${SEP}${m}`,
        label: g.external ? g.providerName : m,
      })),
    ),
  ];
  const modelValue =
    task.providerId && task.modelId ? `${task.providerId}${SEP}${task.modelId}` : 'default';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Pinned header doubles as the window-drag strip; the controls opt out. */}
      <header className="app-drag flex shrink-0 items-start gap-2 px-6 pt-9 pb-1">
        <IconBtn title={t('common.close')} onClick={onClose}>
          <X className="size-4" />
        </IconBtn>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const v = title.trim();
            if (v && v !== task.title) save({ title: v });
            else setTitle(task.title);
          }}
          aria-label={t('scheduled.titleLabel')}
          className="app-no-drag mt-0.5 min-w-0 flex-1 rounded bg-transparent font-semibold text-fg-primary text-lg leading-snug outline-0 focus:bg-surface"
        />
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
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => {
            const v = prompt.trim();
            if (v && v !== task.prompt) save({ prompt: v });
            else setPrompt(task.prompt);
          }}
          rows={2}
          aria-label={t('scheduled.promptLabel')}
          // field-sizing:content auto-grows the textarea to fit (Chromium 123+),
          // so it reads like editing text in place; resize-none drops the handle.
          className="-mx-2 mt-4 max-h-[45vh] w-[calc(100%+1rem)] resize-none overflow-y-auto rounded-md bg-transparent px-2 py-1.5 text-fg-secondary text-sm leading-relaxed outline-0 [field-sizing:content] hover:bg-surface focus:bg-surface"
        />

        <Block title={t('scheduled.status')}>
          <Row label={t('scheduled.status')}>
            <StatusBadge enabled={task.enabled} t={t} />
          </Row>
          <Row label={t('scheduled.nextRun')}>
            <span className="text-fg-secondary text-sm">
              {task.nextRunAt ? formatDateTime(task.nextRunAt, lang) : '—'}
            </span>
          </Row>
          <Row label={t('scheduled.lastRan')}>
            <span className="text-fg-secondary text-sm">
              {task.lastRunAt ? formatDateTime(task.lastRunAt, lang) : t('scheduled.never')}
            </span>
          </Row>
        </Block>

        <Block title={t('scheduled.details')}>
          <Row label={t('scheduled.runsIn')}>
            <span className="text-fg-secondary text-sm">{t('scheduled.local')}</span>
          </Row>
          <Row label={t('scheduled.project')}>
            <Select
              value={task.projectId ?? 'none'}
              onChange={(v) => save({ projectId: v === 'none' ? null : v })}
              options={projectOptions}
              aria-label={t('scheduled.project')}
            />
          </Row>
          <Row label={t('scheduled.model')}>
            <Select
              value={modelValue}
              onChange={(v) => {
                if (v === 'default') save({ providerId: null, modelId: null });
                else {
                  const [providerId, modelId] = v.split(SEP);
                  save({ providerId, modelId });
                }
              }}
              options={modelOptions}
              aria-label={t('scheduled.model')}
            />
          </Row>
        </Block>

        <Block title={t('scheduled.repeats')}>
          <div className="pt-2">
            <ScheduleEditor task={task} lang={lang} onChange={(p: SchedulePatch) => save(p)} />
          </div>
        </Block>

        <Block title={t('scheduled.previousRuns')}>
          {runs.data && runs.data.length > 0 ? (
            <div className="flex flex-col">
              {runs.data.map((run) => (
                <RunRow key={run.id} run={run} title={task.title} lang={lang} onOpen={openThread} />
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
    <span className="inline-flex items-center gap-1.5 text-fg-secondary text-sm">
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
    <section className="mt-5">
      <h3 className="mb-1 font-semibold text-fg-primary text-sm">{title}</h3>
      <div>{children}</div>
    </section>
  );
}
