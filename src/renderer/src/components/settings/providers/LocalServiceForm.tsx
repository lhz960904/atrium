import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BaseUrlField } from './BaseUrlField';
import { ModelsBlock } from './ModelsBlock';
import type { ProviderView } from './types';

type LocalServiceFormProps = {
  provider: Extract<ProviderView, { kind: 'local-service' }>;
};

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Settings panel for a local model service (Ollama): liveness, base URL
 * override, the installed-model list, and the download section. Models pulled
 * outside Atrium (a terminal `ollama pull`) should just show up, so the list
 * refreshes automatically whenever the service is seen running — the manual
 * fetch button remains as the immediate-refresh affordance.
 */
export function LocalServiceForm({ provider }: LocalServiceFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  // Poll while the panel is open so starting/stopping the service outside
  // Atrium is noticed without a manual refresh. Local + 1.5s-timeout = cheap.
  const status = trpc.providers.detectLocalService.useQuery(
    { id: provider.id },
    { refetchInterval: 5000 },
  );
  const running = status.data?.running ?? false;

  const fetchModels = trpc.providers.fetchModels.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: mutate is stable; refresh once per running-flip
  useEffect(() => {
    if (running) fetchModels.mutate({ id: provider.id });
  }, [running, provider.id]);

  const config = (provider.config ?? {}) as {
    baseUrl?: string;
    fetchedModels?: string[];
    enabledModels?: string[];
  };
  const installed = config.fetchedModels ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <StatusLine running={running} version={status.data?.version} loading={status.isLoading} />
      <BaseUrlField
        providerId={provider.id}
        initialValue={config.baseUrl ?? ''}
        defaultBaseUrl={provider.defaultBaseUrl}
      />
      <ModelsBlock
        providerId={provider.id}
        canFetch={running}
        emptyHint={
          running
            ? t('settings.providers.localService.emptyModels')
            : t('settings.providers.localService.notRunning')
        }
        models={installed}
        enabledModels={config.enabledModels ?? []}
        grow={false}
      />
      {running && (
        <DownloadSection
          providerId={provider.id}
          installed={installed}
          onInstalled={() => fetchModels.mutate({ id: provider.id })}
        />
      )}
    </div>
  );
}

type DownloadSectionProps = {
  providerId: string;
  installed: string[];
  /** A pull finished — refresh the installed list so the model appears above. */
  onInstalled: () => void;
};

/**
 * The minimal download flow: type a model name (browse the linked library
 * site to find one), the registry probe validates it and shows its size, and
 * the download renders as progress rows below — polled from the main-process
 * pull manager, fast while something is downloading, lazily otherwise.
 */
function DownloadSection({
  providerId,
  installed,
  onInstalled,
}: DownloadSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  // Debounced copy of the input drives the registry probe — one request per
  // pause in typing, not per keystroke.
  const [probeTarget, setProbeTarget] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setProbeTarget(value.trim()), 400);
    return () => clearTimeout(timer);
  }, [value]);

  const pulls = trpc.providers.pullStates.useQuery(
    { id: providerId },
    { refetchInterval: (data) => ((data?.length ?? 0) > 0 ? 600 : 2500) },
  );
  const pullModel = trpc.providers.pullModel.useMutation({
    onSuccess: () => pulls.refetch(),
  });
  const probe = trpc.providers.probeModels.useQuery(
    { id: providerId, models: [probeTarget] },
    { enabled: probeTarget.length > 0, staleTime: Number.POSITIVE_INFINITY },
  );
  const probed = probeTarget ? probe.data?.[probeTarget] : undefined;

  // Each successful pull triggers one installed-list refresh; the terminal
  // entry lingers across several polls, so dedupe by model name.
  const refreshed = useRef(new Set<string>());
  useEffect(() => {
    for (const p of pulls.data ?? []) {
      if (p.done && !p.error && !refreshed.current.has(p.model)) {
        refreshed.current.add(p.model);
        onInstalled();
      }
    }
  }, [pulls.data, onInstalled]);

  const installedSet = new Set(installed);
  const activePulls = (pulls.data ?? []).filter((p) => !installedSet.has(p.model));

  const startPull = (model: string): void => {
    refreshed.current.delete(model);
    pullModel.mutate({ id: providerId, model });
    setValue('');
  };

  return (
    <div className="shrink-0">
      <h3 className="mb-1 font-medium text-fg-secondary text-xs">
        {t('settings.providers.localService.downloadTitle')}
      </h3>
      <p className="mb-2 text-fg-tertiary text-xs">
        {t('settings.providers.localService.downloadHint')}{' '}
        <a
          href="https://ollama.com/library"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg-secondary"
        >
          ollama.com/library
        </a>
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const model = value.trim();
          if (model && probed?.exists !== false) startPull(model);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('settings.providers.localService.customPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border-default bg-elevated px-3 py-2 font-mono text-fg-primary text-sm outline-none placeholder:text-fg-disabled focus:border-accent"
        />
        <button
          type="submit"
          disabled={!value.trim() || probed?.exists === false}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-elevated px-2.5 py-1 text-fg-secondary text-xs hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="size-[12px]" />
          {t('settings.providers.localService.download')}
        </button>
      </form>

      {probeTarget.length > 0 && (
        <p
          className={`mt-1.5 text-xs ${
            probed?.exists === true
              ? 'text-success'
              : probed?.exists === false
                ? 'text-danger'
                : 'text-fg-tertiary'
          }`}
        >
          {probe.isFetching
            ? t('settings.providers.localService.verifying')
            : probed?.exists === true
              ? // No layer blobs = a cloud-hosted model (runs on ollama.com,
                // the pull only registers a pointer) — say so instead of a size.
                formatBytes(probed.sizeBytes)
                ? t('settings.providers.localService.foundSize', {
                    size: formatBytes(probed.sizeBytes),
                  })
                : t('settings.providers.localService.foundCloud')
              : probed?.exists === false
                ? t('settings.providers.localService.notFound')
                : probed
                  ? t('settings.providers.localService.verifyFailed')
                  : ''}
        </p>
      )}

      {activePulls.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {activePulls.map((p) => (
            <li
              key={p.model}
              className="flex items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-fg-primary text-sm">
                {p.model}
              </span>
              <PullProgress pull={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PullProgress({
  pull,
}: {
  pull: { status: string; completed?: number; total?: number; error?: string };
}): React.JSX.Element {
  if (pull.error) {
    return (
      <span className="min-w-0 flex-1 truncate text-right text-danger text-xs">{pull.error}</span>
    );
  }
  const pct =
    pull.total && pull.completed !== undefined
      ? Math.min(100, Math.round((pull.completed / pull.total) * 100))
      : undefined;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="shrink-0 text-fg-tertiary text-xs">{pull.status}</span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-strong">
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct ?? 0}%` }}
        />
      </span>
      <span className="w-9 shrink-0 text-right font-mono text-fg-secondary text-xs">
        {pct !== undefined ? `${pct}%` : ''}
      </span>
    </span>
  );
}

type StatusLineProps = { running: boolean; version?: string; loading: boolean };

function StatusLine({ running, version, loading }: StatusLineProps): React.JSX.Element {
  const { t } = useTranslation();
  if (loading) {
    return <p className="text-fg-tertiary text-sm">{t('common.loading')}</p>;
  }
  if (running) {
    return (
      <p className="flex items-center gap-2 text-fg-secondary text-sm">
        <span className="size-2 rounded-full bg-success" />
        {t('settings.providers.localService.running', { version: version ?? '?' })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-2 text-fg-secondary text-sm">
        <span className="size-2 rounded-full bg-fg-tertiary" />
        {t('settings.providers.localService.notRunning')}
      </p>
      <p className="text-fg-tertiary text-sm">
        {t('settings.providers.localService.installHint')}{' '}
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          ollama.com/download
        </a>
      </p>
    </div>
  );
}
