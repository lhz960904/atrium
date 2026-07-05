import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

type SelectProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  'aria-label'?: string;
  /** Extra classes for the trigger, e.g. `w-full` to fill a column. */
  className?: string;
};

/** Compact dropdown over Radix Select — the default control for enumerated
 *  settings. Unlike a native <select>, the panel is app-themed (so it doesn't
 *  flash an OS-rendered light menu in dark mode) and matches the ModelPicker. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className,
}: SelectProps<T>): React.JSX.Element {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className={`inline-flex min-w-[150px] items-center justify-between gap-2 rounded-lg border border-border-default bg-surface py-1.5 pr-2.5 pl-3 text-fg-primary text-sm outline-0 transition-colors hover:border-border-strong focus:border-accent data-[state=open]:border-accent ${className ?? ''}`}
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-fg-tertiary" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          // Lock the panel to the trigger's width so the two always match.
          className="z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-default bg-elevated shadow-lg"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pr-8 pl-3 text-fg-primary text-sm outline-0 data-[highlighted]:bg-surface-strong data-[state=checked]:text-accent"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2 inline-flex">
                  <Check className="size-[14px]" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
