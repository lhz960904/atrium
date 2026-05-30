type Status = 'enabled' | 'configured' | 'detected' | 'idle';

/**
 * A single row in the provider list. Status dot:
 *   enabled    → solid green dot
 *   configured → grey dot (credentials present but toggle off)
 *   detected   → translucent accent dot (local CLI binary on PATH, never enabled)
 *   idle       → no dot
 */
export function ProviderRow({
  name,
  icon,
  status,
  active,
  onSelect,
}: {
  name: string;
  icon: React.ReactNode;
  status: Status;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'bg-elevated text-fg-primary'
          : 'text-fg-secondary hover:bg-surface-strong hover:text-fg-primary'
      }`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-fg-primary text-base">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <StatusDot status={status} />
    </button>
  );
}

function StatusDot({ status }: { status: Status }): React.JSX.Element | null {
  if (status === 'idle') return <span className="size-1.5" />;
  if (status === 'enabled') return <span className="size-1.5 rounded-full bg-success" />;
  if (status === 'configured') return <span className="size-1.5 rounded-full bg-fg-disabled" />;
  return <span className="size-1.5 rounded-full bg-accent/40" />;
}
