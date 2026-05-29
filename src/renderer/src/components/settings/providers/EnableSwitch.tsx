export function EnableSwitch({
  on,
  disabled = false,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-surface-strong'
      } ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block size-[14px] rounded-full bg-elevated shadow-sm transition-transform ${
          on ? 'translate-x-[14px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
