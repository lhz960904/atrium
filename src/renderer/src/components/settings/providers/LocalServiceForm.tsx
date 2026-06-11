import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { BaseUrlField } from './BaseUrlField';
import { ModelsBlock } from './ModelsBlock';
import type { ProviderView } from './types';

type LocalServiceFormProps = {
  provider: Extract<ProviderView, { kind: 'local-service' }>;
};

/**
 * Settings panel for a local model service (Ollama): liveness, base URL
 * override, and the installed-model list. Models pulled outside Atrium (a
 * terminal `ollama pull`) should just show up, so the list refreshes
 * automatically whenever the service is seen running — the manual fetch
 * button remains as the immediate-refresh affordance.
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
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
        models={config.fetchedModels ?? []}
        enabledModels={config.enabledModels ?? []}
      />
    </div>
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
