import { useEffect, useMemo } from 'react';
import { type SelectedModel, useModelStore } from '../state/model-store';
import { trpc } from './trpc';
import { useSetting } from './use-setting';

/** A provider with its enabled models, for the picker's grouped list. `external`
 *  marks a local-CLI/ACP provider — the picker shows it as a single entry (the
 *  provider name), since the agent chooses its own model. */
export type ModelGroup = {
  providerId: string;
  providerName: string;
  models: string[];
  external?: boolean;
};

/**
 * Synthetic model id for a local-CLI provider. The external agent chooses its
 * own model, so there's nothing to pick — but the picker is model-grouped, so
 * an enabled local-CLI provider gets this one entry. The backend forks on the
 * provider kind and ignores the model id for these turns.
 */
export const EXTERNAL_AGENT_MODEL = 'default';

export function deriveGroups(
  providers: {
    id: string;
    name: string;
    kind: 'cloud-api' | 'local-cli' | 'local-service';
    enabled: boolean;
    config: Record<string, unknown> | null;
  }[],
): ModelGroup[] {
  // local-service providers list models like cloud ones (config.enabledModels),
  // so only local-cli takes the synthetic single-entry path below.
  const groups: ModelGroup[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    if (p.kind === 'local-cli') {
      groups.push({
        providerId: p.id,
        providerName: p.name,
        models: [EXTERNAL_AGENT_MODEL],
        external: true,
      });
      continue;
    }
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
  const {
    value: persistedModel,
    set: persistModel,
    isLoading: persistLoading,
  } = useSetting('general.defaultModel');
  const selected = useModelStore((s) => s.selected);
  const setStore = useModelStore((s) => s.setSelected);

  const groups = useMemo(() => deriveGroups(providers.data ?? []), [providers.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setStore is stable
  useEffect(() => {
    if (!providers.data || persistLoading) return;
    if (isValid(selected, groups)) return;
    const candidate = persistedModel ?? null;
    const next = isValid(candidate, groups) ? candidate : firstModel(groups);
    if (next) setStore(next);
  }, [providers.data, persistedModel, persistLoading, selected, groups]);

  const setSelected = (m: SelectedModel): void => {
    setStore(m);
    persistModel(m);
  };

  return { selected, groups, setSelected, loading: providers.isLoading };
}
