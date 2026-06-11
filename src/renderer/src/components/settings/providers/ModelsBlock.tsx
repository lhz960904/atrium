import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { EnableSwitch } from './EnableSwitch';

export function ModelsBlock({
  providerId,
  canFetch,
  emptyHint,
  models,
  enabledModels,
}: {
  providerId: string;
  /** Whether the fetch action is currently possible (key saved / service up). */
  canFetch: boolean;
  /** Shown in the empty state — the caller knows why the list is empty. */
  emptyHint: string;
  models: string[];
  enabledModels: string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const fetchModels = trpc.providers.fetchModels.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  const updateConfig = trpc.providers.updateConfig.useMutation({
    onMutate: async ({ id, partial }) => {
      await utils.providers.list.cancel();
      const prev = utils.providers.list.getData();
      utils.providers.list.setData(undefined, (old) =>
        old?.map((p) => (p.id === id ? { ...p, config: { ...(p.config ?? {}), ...partial } } : p)),
      );
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) utils.providers.list.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.providers.list.invalidate(),
  });

  const enabledSet = useMemo(() => new Set(enabledModels), [enabledModels]);

  // Enabled-first sort keeps the user's picks pinned to the top of a long
  // aggregator list (OpenRouter / AiHubMix easily ship 300+ models).
  const sortedModels = useMemo(
    () => [...models].sort((a, b) => Number(enabledSet.has(b)) - Number(enabledSet.has(a))),
    [models, enabledSet],
  );

  const toggleModel = (modelId: string): void => {
    const next = enabledSet.has(modelId)
      ? enabledModels.filter((m) => m !== modelId)
      : [...enabledModels, modelId];
    updateConfig.mutate({ id: providerId, partial: { enabledModels: next } });
  };

  const fetchDisabled = !canFetch || fetchModels.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h3 className="font-medium text-fg-secondary text-xs">
          {t('settings.providers.models')}
          {models.length > 0 && (
            <span className="ml-2 font-normal text-fg-tertiary">
              {t('settings.providers.enabledCount', { on: enabledSet.size, total: models.length })}
            </span>
          )}
        </h3>
        <button
          type="button"
          disabled={fetchDisabled}
          onClick={() => fetchModels.mutate({ id: providerId })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-elevated px-2.5 py-1 text-fg-secondary text-xs hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fetchModels.isLoading ? (
            <Loader2 className="size-[12px] animate-spin" />
          ) : (
            <Download className="size-[12px]" />
          )}
          {t('settings.providers.fetch')}
        </button>
      </div>

      {fetchModels.error && (
        <div className="mb-2 flex shrink-0 items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-danger text-xs">
          <AlertCircle className="mt-0.5 size-[13px] shrink-0" />
          <span className="min-w-0 break-words">{fetchModels.error.message}</span>
        </div>
      )}

      {models.length === 0 ? (
        <div className="shrink-0 rounded-lg border border-border-default border-dashed bg-surface px-6 py-8 text-center">
          <p className="text-fg-tertiary text-sm">{emptyHint}</p>
        </div>
      ) : (
        <ul
          style={{ scrollbarGutter: 'stable' }}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
        >
          {sortedModels.map((m) => {
            const on = enabledSet.has(m);
            return (
              <li
                key={m}
                className="flex shrink-0 items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-fg-primary text-sm">
                  {m}
                </span>
                <EnableSwitch on={on} onToggle={() => toggleModel(m)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
