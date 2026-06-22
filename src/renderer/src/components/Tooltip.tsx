import * as RadixTooltip from '@radix-ui/react-tooltip';

/**
 * Portaled hover tooltip — escapes the sidebar's overflow clip, unlike a
 * CSS-positioned one. Self-contained Provider so it drops in anywhere without
 * a root-level provider.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
}: {
  content: React.ReactNode;
  side?: RadixTooltip.TooltipContentProps['side'];
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-50 select-none rounded-md border border-border-default bg-elevated px-2 py-1 text-fg-secondary text-xs shadow-lg"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
