import { Command } from 'lucide-react';
import { bindingParts, IS_MAC } from '../lib/keymap';

/** Renders a binding as keycaps: ⌘ becomes the Command glyph icon (the Unicode
 *  ⌘ reads small in a mono font), other modifiers and the key stay as text, with
 *  a little gap between parts. Text contexts should use formatBinding instead. */
export function Kbd({ binding }: { binding: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      {bindingParts(binding).map((part) =>
        part.kind === 'mod' && IS_MAC ? (
          <Command key={part.kind} className="size-[11px]" aria-label="Command" />
        ) : (
          <span key={part.kind} className="font-mono text-[11px] leading-none">
            {part.label}
          </span>
        ),
      )}
    </span>
  );
}
