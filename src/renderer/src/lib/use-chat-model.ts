import { useEffect, useMemo } from 'react';
import { NEW_CHAT, type SelectedModel, useModelStore } from '../state/model-store';
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

const sameModel = (a: SelectedModel | null, b: SelectedModel | null): boolean =>
  a?.providerId === b?.providerId && a?.modelId === b?.modelId;

/**
 * The chat model for one thread (NEW_CHAT on the home composer). Resolves, in
 * order: this session's live pick → the thread's persisted binding → the global
 * default (`general.defaultModel`) → the first available model, skipping any no
 * longer enabled. Publishes the result to the model store — the transport reads
 * it back by threadId at send time — and persists a pick onto the thread.
 */
export function useChatModel(threadId: string = NEW_CHAT) {
  const utils = trpc.useUtils();
  const providers = trpc.providers.list.useQuery();
  const { value: defaultModel } = useSetting('general.defaultModel');
  const thread = trpc.threads.get.useQuery({ id: threadId }, { enabled: threadId !== NEW_CHAT });
  const stored = useModelStore((s) => s.byThread[threadId]);
  const setForThread = useModelStore((s) => s.setForThread);
  const setModel = trpc.threads.setModel.useMutation();

  const groups = useMemo(() => deriveGroups(providers.data ?? []), [providers.data]);

  const boundProviderId = thread.data?.modelProviderId;
  const boundModelId = thread.data?.modelId;
  const selected = useMemo(() => {
    // Home composer: no thread to bind to, so this session's pick is the binding.
    if (threadId === NEW_CHAT) {
      if (isValid(stored, groups)) return stored;
      if (isValid(defaultModel, groups)) return defaultModel;
      return firstModel(groups);
    }
    // A real thread: its persisted binding wins. `setSelected` updates that
    // binding optimistically, so a live pick still shows at once. The store is
    // only the transport's copy and must NOT feed back into resolution — the
    // value it publishes before the thread row loads would otherwise mask the
    // saved binding and make every thread snap back to the default on reload.
    const bound =
      boundProviderId && boundModelId
        ? { providerId: boundProviderId, modelId: boundModelId }
        : null;
    if (isValid(bound, groups)) return bound;
    if (isValid(defaultModel, groups)) return defaultModel;
    return firstModel(groups);
  }, [threadId, stored, boundProviderId, boundModelId, defaultModel, groups]);

  // Publish the resolved model so the transport always has one for this thread,
  // even before any pick. Skip NEW_CHAT: the home composer must not pin a new
  // thread to today's default — only an explicit pick binds it (below).
  // biome-ignore lint/correctness/useExhaustiveDependencies: setForThread is stable
  useEffect(() => {
    if (threadId === NEW_CHAT) return;
    if (selected && !sameModel(stored ?? null, selected)) setForThread(threadId, selected);
  }, [selected, threadId, stored]);

  const setSelected = (m: SelectedModel): void => {
    setForThread(threadId, m);
    if (threadId === NEW_CHAT) return; // no thread yet — carried on first send
    // Reflect the binding at once so display + transport agree before the round-trip.
    utils.threads.get.setData({ id: threadId }, (prev) =>
      prev ? { ...prev, modelProviderId: m.providerId, modelId: m.modelId } : prev,
    );
    setModel.mutate({ id: threadId, model: m });
  };

  return { selected, groups, setSelected, loading: providers.isLoading };
}
