import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { ProviderDetail } from './ProviderDetail';
import { ProvidersList } from './ProvidersList';

export function ProvidersSection(): React.JSX.Element {
  const { data: providers, isLoading } = trpc.providers.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      <aside className="min-h-0 overflow-y-auto border-r border-border-default bg-surface">
        <ProvidersList
          providers={providers}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
      </aside>
      <section className="min-h-0">
        <ProviderDetail provider={selected} />
      </section>
    </div>
  );
}
