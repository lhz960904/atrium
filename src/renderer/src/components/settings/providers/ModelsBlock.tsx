import type { CustomModel } from '@shared/custom-model';
import { AlertCircle, Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { CustomModelDialog } from './CustomModelDialog';
import { EnableSwitch } from './EnableSwitch';

export function ModelsBlock({
  providerId,
  canFetch,
  emptyHint,
  models,
  enabledModels,
  customModels,
  grow = true,
}: {
  providerId: string;
  /** Whether a refresh is possible right now. Absent hides the action entirely:
   *  only a local service has an installed list to read. */
  canFetch?: boolean;
  /** Shown in the empty state — the caller knows why the list is empty. */
  emptyHint: string;
  models: string[];
  enabledModels: string[];
  /** The models the user added here, so they can be edited and removed. */
  customModels?: readonly CustomModel[];
  /** Fill the remaining panel height and scroll the list internally (cloud
   *  forms). false = natural height; the surrounding panel scrolls instead —
   *  required when content stacks below, which would crush a flex-1 block. */
  grow?: boolean;
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

  const removeModel = trpc.providers.removeCustomModel.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });
  const [editing, setEditing] = useState<CustomModel | 'new' | null>(null);

  const enabledSet = useMemo(() => new Set(enabledModels), [enabledModels]);
  const customById = useMemo(
    () => new Map((customModels ?? []).map((m) => [m.id, m])),
    [customModels],
  );

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
    <div className={grow ? 'flex min-h-0 flex-1 flex-col' : 'flex shrink-0 flex-col'}>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h3 className="font-medium text-fg-secondary text-xs">
          {t('settings.providers.models')}
          {models.length > 0 && (
            <span className="ml-2 font-normal text-fg-tertiary">
              {t('settings.providers.enabledCount', { on: enabledSet.size, total: models.length })}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          {customModels && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-elevated px-2.5 py-1 text-fg-secondary text-xs hover:bg-surface-strong"
            >
              <Plus className="size-[12px]" />
              {t('settings.providers.custom.add')}
            </button>
          )}
          {canFetch !== undefined && (
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
          )}
        </div>
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
          style={grow ? { scrollbarGutter: 'stable' } : undefined}
          className={
            grow ? 'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto' : 'flex flex-col gap-1.5'
          }
        >
          {sortedModels.map((m) => {
            const on = enabledSet.has(m);
            const custom = customById.get(m);
            return (
              <li
                key={m}
                className="flex shrink-0 items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-fg-primary text-sm">
                  {m}
                </span>
                {custom && (
                  <>
                    <span className="shrink-0 rounded-full bg-surface-strong px-1.5 py-0.5 text-[10px] text-fg-tertiary uppercase tracking-wider">
                      {t('settings.providers.custom.added')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(custom)}
                      title={t('common.edit')}
                      className="shrink-0 rounded p-1 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
                    >
                      <Pencil className="size-[13px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeModel.mutate({ id: providerId, modelId: m })}
                      title={t('settings.providers.custom.remove')}
                      className="shrink-0 rounded p-1 text-fg-tertiary hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-[13px]" />
                    </button>
                  </>
                )}
                <EnableSwitch on={on} onToggle={() => toggleModel(m)} />
              </li>
            );
          })}
        </ul>
      )}

      {/* Mounted per edit: the form holds a draft, and a reused instance would
          open the next model with the previous one's values still in it. */}
      {editing && (
        <CustomModelDialog
          key={editing === 'new' ? 'new' : editing.id}
          providerId={providerId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
