import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { AddProviderDialog } from './AddProviderDialog';
import { CustomProviderDialog } from './CustomProviderDialog';
import { ProviderDetail } from './ProviderDetail';
import { ProvidersList } from './ProvidersList';

export function ProvidersSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: providers, isLoading } = trpc.providers.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 'pick' chooses from the shipped list; 'define' writes a new one. */
  const [adding, setAdding] = useState<'pick' | 'define' | null>(null);

  if (isLoading || !providers) {
    return (
      <div className="flex h-full items-center justify-center text-fg-tertiary text-sm">
        Loading…
      </div>
    );
  }

  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  return (
    <div className="grid h-full grid-cols-[260px_1fr] gap-0 overflow-hidden rounded-xl border border-border-default bg-canvas">
      <aside className="flex min-h-0 flex-col border-r border-border-default bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {providers.length === 0 ? (
            <p className="px-4 py-6 text-center text-fg-tertiary text-xs leading-relaxed">
              {t('settings.providers.noneAdded')}
            </p>
          ) : (
            <ProvidersList
              providers={providers}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding('pick')}
          className="flex shrink-0 items-center gap-1.5 border-border-default border-t px-4 py-2.5 text-fg-secondary text-xs hover:bg-surface-strong"
        >
          <Plus className="size-[13px]" />
          {t('settings.providers.addProvider')}
        </button>
      </aside>
      <section className="min-h-0">
        <ProviderDetail provider={selected} />
      </section>

      {adding === 'pick' && (
        <AddProviderDialog
          onClose={() => setAdding(null)}
          onAdded={setSelectedId}
          onDefineCustom={() => setAdding('define')}
        />
      )}
      {adding === 'define' && (
        <CustomProviderDialog
          editing="new"
          onClose={() => setAdding(null)}
          onCreated={setSelectedId}
        />
      )}
    </div>
  );
}
