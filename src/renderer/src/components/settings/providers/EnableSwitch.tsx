import * as Switch from '@radix-ui/react-switch';

type EnableSwitchProps = {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export function EnableSwitch({
  on,
  disabled = false,
  onToggle,
}: EnableSwitchProps): React.JSX.Element {
  return (
    <Switch.Root
      checked={on}
      disabled={disabled}
      onCheckedChange={onToggle}
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-surface-strong'
      } ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      <Switch.Thumb
        className={`inline-block size-[14px] rounded-full bg-elevated shadow-sm transition-transform ${
          on ? 'translate-x-[14px]' : 'translate-x-[2px]'
        }`}
      />
    </Switch.Root>
  );
}
