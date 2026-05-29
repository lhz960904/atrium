import { ProviderIcon } from './ProviderIcon';
import { ProviderRow } from './ProviderRow';
import type { ProviderView } from './types';

export function ProvidersList({
  providers,
  selectedId,
  onSelect,
}: {
  providers: ProviderView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
      {providers.map((p) => (
        <ProviderRow
          key={p.id}
          name={p.name}
          icon={<ProviderIcon id={p.id} className="size-4 text-fg-primary" />}
          status={p.enabled ? 'enabled' : p.hasCredentials ? 'configured' : 'idle'}
          active={p.id === selectedId}
          onSelect={() => onSelect(p.id)}
        />
      ))}
    </div>
  );
}
