import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { ApiKeyField } from './ApiKeyField';
import { BaseUrlField } from './BaseUrlField';
import { EnableSwitch } from './EnableSwitch';
import { LocalCliForm } from './LocalCliForm';
import { ModelsBlock } from './ModelsBlock';
import type { ProviderView } from './types';

export function ProviderDetail({ provider }: { provider: ProviderView }): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const setEnabled = trpc.providers.setEnabled.useMutation({
    onMutate: async ({ id, enabled }) => {
      await utils.providers.list.cancel();
      const prev = utils.providers.list.getData();
      utils.providers.list.setData(undefined, (old) =>
        old?.map((p) => (p.id === id ? { ...p, enabled } : p)),
      );
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) utils.providers.list.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.providers.list.invalidate();
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-8 py-6">
      <div className="mb-6 flex shrink-0 items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-semibold text-fg-primary text-lg tracking-tight">
              {provider.name}
            </h2>
            <ActiveBadge enabled={provider.enabled} />
          </div>
          <p className="text-fg-tertiary text-sm leading-snug">
            {t(provider.descriptionKey as ParseKeys)}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <EnableSwitch
            on={provider.enabled}
            onToggle={() => setEnabled.mutate({ id: provider.id, enabled: !provider.enabled })}
          />
        </div>
      </div>

      {provider.kind === 'cloud-api' ? (
        <CloudApiForm key={provider.id} provider={provider} />
      ) : (
        <LocalCliForm key={provider.id} provider={provider} />
      )}
    </div>
  );
}

function CloudApiForm({
  provider,
}: {
  provider: Extract<ProviderView, { kind: 'cloud-api' }>;
}): React.JSX.Element {
  const config = (provider.config ?? {}) as {
    baseUrl?: string;
    fetchedModels?: string[];
    enabledModels?: string[];
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <ApiKeyField
        providerId={provider.id}
        hasCredentials={provider.hasCredentials}
        consoleUrl={provider.consoleUrl}
      />
      <BaseUrlField
        providerId={provider.id}
        initialValue={config.baseUrl ?? ''}
        defaultBaseUrl={provider.defaultBaseUrl}
      />
      <ModelsBlock
        providerId={provider.id}
        hasCredentials={provider.hasCredentials}
        models={config.fetchedModels ?? []}
        enabledModels={config.enabledModels ?? []}
      />
    </div>
  );
}

function ActiveBadge({ enabled }: { enabled: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  if (enabled) {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 font-medium text-[10.5px] text-success uppercase tracking-wider">
        {t('settings.providers.active')}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-strong px-2 py-0.5 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider">
      {t('settings.providers.notConfigured')}
    </span>
  );
}
