import {
  Atom,
  Box,
  Brain,
  Download,
  Eraser,
  GitBranch,
  ListChecks,
  type LucideIcon,
  Octagon,
  Palette,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { zh } from '../../../i18n/zh';

export type SlashMenuItem = {
  name: string;
  desc: string;
  icon?: LucideIcon;
  /** Grouping for section headers; 'skill' rows sit under a "Skills" header. */
  group?: 'command' | 'skill';
  /** Right-aligned source label (skills only, e.g. the ecosystem it came from). */
  tag?: string;
  /** Set on skill rows: the skill name to invoke when selected. */
  skill?: string;
};

type SlashCommandDef = {
  name: string;
  descKey: `slashMenu.${keyof typeof zh.slashMenu}`;
  icon?: LucideIcon;
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'Branch', descKey: 'slashMenu.branch', icon: GitBranch },
  { name: 'Clear', descKey: 'slashMenu.clear', icon: Eraser },
  { name: 'Compact', descKey: 'slashMenu.compact', icon: Box },
  { name: 'Export', descKey: 'slashMenu.export', icon: Download },
  { name: 'Memories', descKey: 'slashMenu.memories', icon: Brain },
  { name: 'Model', descKey: 'slashMenu.model', icon: Atom },
  { name: 'Permissions', descKey: 'slashMenu.permissions', icon: SlidersHorizontal },
  { name: 'Plan mode', descKey: 'slashMenu.planMode', icon: ListChecks },
  { name: 'Search', descKey: 'slashMenu.search', icon: Search },
  { name: 'Settings', descKey: 'slashMenu.settings', icon: SlidersHorizontal },
  { name: 'Stop', descKey: 'slashMenu.stop', icon: Octagon },
  { name: 'Theme', descKey: 'slashMenu.theme', icon: Palette },
];

export function SlashMenu({
  items,
  query,
  activeIndex,
  onHoverIndex,
  onSelect,
}: {
  items: SlashMenuItem[];
  /** Text after the trigger char (e.g. "co" filters items starting with "co"). */
  query: string;
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: SlashMenuItem) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const filtered = items.filter((item) =>
    query.length === 0 ? true : item.name.toLowerCase().startsWith(query.toLowerCase()),
  );

  // Keep active index in range
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onHoverIndex(Math.max(0, filtered.length - 1));
    }
  }, [activeIndex, filtered.length, onHoverIndex]);

  // Keep the keyboard-selected row visible — arrow nav past the viewport edge
  // would otherwise leave the active row scrolled out of sight.
  const activeRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIndex is the intended trigger; the body scrolls the ref it points to
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-hidden rounded-lg border border-border-default bg-elevated shadow-md">
      <ul className="max-h-[280px] overflow-y-auto py-1">
        {filtered.map((item, i) => {
          const Icon = item.icon;
          const active = i === activeIndex;
          // Section header before the first skill row (commands sit above, untitled).
          const showSkillHeader = item.group === 'skill' && filtered[i - 1]?.group !== 'skill';
          return (
            <Fragment key={item.name}>
              {showSkillHeader && (
                <li className="px-3 pt-2 pb-1 text-fg-tertiary text-xs">
                  {t('settings.sections.skillsTitle')}
                </li>
              )}
              <li>
                <button
                  type="button"
                  ref={active ? activeRef : undefined}
                  onMouseEnter={() => onHoverIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before click handler fires
                    e.preventDefault();
                  }}
                  onClick={() => onSelect(item)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                    active ? 'bg-surface-strong text-fg-primary' : 'text-fg-secondary'
                  }`}
                >
                  {Icon && <Icon className="size-4 shrink-0 text-fg-tertiary" />}
                  <span className="shrink-0 font-medium">{item.name}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-tertiary text-xs">
                    {item.desc}
                  </span>
                  {item.tag && (
                    <span className="shrink-0 text-fg-disabled text-xs">{item.tag}</span>
                  )}
                </button>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}
