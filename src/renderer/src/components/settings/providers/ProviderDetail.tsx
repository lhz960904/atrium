import type { CustomModel, CustomProvider } from '@shared/custom-model';
import type { ParseKeys } from 'i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { ApiKeyField } from './ApiKeyField';
import { BaseUrlField } from './BaseUrlField';
import { CustomProviderDialog } from './CustomProviderDialog';
import { EnableSwitch } from './EnableSwitch';
import { ModelsBlock } from './ModelsBlock';
import { SubscriptionForm } from './SubscriptionForm';
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
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <ProviderActions provider={provider} />
          <EnableSwitch
            on={provider.enabled}
            onToggle={() => setEnabled.mutate({ id: provider.id, enabled: !provider.enabled })}
          />
        </div>
      </div>

      {provider.kind === 'cloud-api' ? (
        <CloudApiForm key={provider.id} provider={provider} />
      ) : (
        <SubscriptionForm key={provider.id} provider={provider} />
      )}
    </div>
  );
}

function CloudApiForm({ provider }: { provider: ProviderView }): React.JSX.Element {
  const { t } = useTranslation();
  const config = (provider.config ?? {}) as {
    baseUrl?: string;
    enabledModels?: string[];
    customModels?: CustomModel[];
  };
  // The catalog is the whole list. An endpoint that serves something it doesn't
  // cover is what the add-model editor is for.
  const models = (provider.models ?? []).map((m) => m.id);
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
        defaultBaseUrl={provider.defaultBaseUrl ?? ''}
      />
      <ModelsBlock
        providerId={provider.id}
        emptyHint={t('settings.providers.emptyCatalog')}
        models={models}
        enabledModels={config.enabledModels ?? []}
        customModels={config.customModels ?? []}
      />
    </div>
  );
}

/**
 * Remove, for any added provider, and edit for one the user defined. Removing a
 * shipped provider is how it leaves the list — the same gesture as deleting a
 * defined one, since being in the list is all that "added" means.
 */
function ProviderActions({ provider }: { provider: ProviderView }): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const remove = trpc.providers.remove.useMutation({
    onSuccess: () => {
      utils.providers.list.invalidate();
      utils.providers.available.invalidate();
    },
  });
  const stored = (provider.config as { customProvider?: CustomProvider } | null)?.customProvider;
  return (
    <>
      {stored && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={t('common.edit')}
          className="rounded p-1.5 text-fg-tertiary hover:bg-surface-strong hover:text-fg-secondary"
        >
          <Pencil className="size-[14px]" />
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm(t('settings.providers.removeConfirm', { name: provider.name }))) {
            remove.mutate({ id: provider.id });
          }
        }}
        title={t('settings.providers.remove')}
        className="rounded p-1.5 text-fg-tertiary hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="size-[14px]" />
      </button>
      {editing && stored && (
        <CustomProviderDialog
          editing={{ id: provider.id, ...stored }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
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
