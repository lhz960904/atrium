import { useEffect, useMemo } from 'react';
import { type SelectedModel, useModelStore } from '../state/model-store';
import { trpc } from './trpc';

/** A provider with its enabled models, for the picker's grouped list. */
export type ModelGroup = { providerId: string; providerName: string; models: string[] };

export function deriveGroups(
  providers: {
    id: string;
    name: string;
    enabled: boolean;
    config: Record<string, unknown> | null;
  }[],
): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    const models = (p.config as { enabledModels?: string[] } | null)?.enabledModels ?? [];
    if (models.length > 0) groups.push({ providerId: p.id, providerName: p.name, models });
  }
  return groups;
}

function isValid(m: SelectedModel | null, groups: ModelGroup[]): m is SelectedModel {
  if (!m) return false;
  return groups.some((g) => g.providerId === m.providerId && g.models.includes(m.modelId));
}

function firstModel(groups: ModelGroup[]): SelectedModel | null {
  const g = groups[0];
  return g ? { providerId: g.providerId, modelId: g.models[0] } : null;
}

/**
 * Single source of truth for the chat model: derives the enabled-model groups
 * from providers, hydrates the store (persisted choice if still valid, else
 * first available), and persists changes. Both the composer's ModelPicker and
 * the chat transport call this; react-query dedupes the queries and the
 * hydration effect is idempotent.
 */
export function useChatModel() {
  const providers = trpc.providers.list.useQuery();
  const persisted = trpc.settings.selectedModel.useQuery();
  const persist = trpc.settings.setSelectedModel.useMutation();
  const selected = useModelStore((s) => s.selected);
  const setStore = useModelStore((s) => s.setSelected);

  const groups = useMemo(() => deriveGroups(providers.data ?? []), [providers.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setStore is stable
  useEffect(() => {
    if (!providers.data || persisted.isLoading) return;
    if (isValid(selected, groups)) return;
    const candidate = persisted.data ?? null;
    const next = isValid(candidate, groups) ? candidate : firstModel(groups);
    if (next) setStore(next);
  }, [providers.data, persisted.data, persisted.isLoading, selected, groups]);

  const setSelected = (m: SelectedModel): void => {
    setStore(m);
    persist.mutate(m);
  };

  return { selected, groups, setSelected, loading: providers.isLoading };
}
