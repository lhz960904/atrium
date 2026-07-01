import { Extension, type Extensions } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { type LucideIcon, Package } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { skillSourceLabel } from '../../../lib/skill-source';
import { trpc } from '../../../lib/trpc';
import type { SlashMenuItem } from './SlashMenu';
import { SkillMention } from './skill-mention';

/**
 * The `/` menu: a Tiptap suggestion that lists commands and discovered skills,
 * bridged to our own SlashMenu (anchored at the composer bottom). Selecting a
 * skill inserts a skill chip; selecting a command runs its action.
 */

export type SkillSuggestionItem = { name: string; description: string; source: string };

/** A `/` command — runs an action (no chip), e.g. compact the conversation. */
export type SlashCommand = {
  name: string;
  description: string;
  icon?: LucideIcon;
  run: () => void;
};

/** One `/` menu entry: a skill (inserts a chip) or a command (runs an action). */
export type SlashEntry =
  | { kind: 'skill'; item: SkillSuggestionItem }
  | { kind: 'command'; item: SlashCommand };

/** What the React layer needs to render and act on the open suggestion. */
export type SuggestionView = {
  items: SlashEntry[];
  command: (entry: SlashEntry) => void;
};

export type SlashSuggestionOptions = {
  /** Entries for the current query (commands + skills; caller reads fresh state). */
  items: (query: string) => SlashEntry[];
  /** The suggestion opened/updated (a view), or closed (null) — handed to React. */
  onChange: (view: SuggestionView | null) => void;
  /** Arrow/Enter while open — React handles nav/select, returns whether handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * `/`-triggered suggestion bridged to our React dropdown rather than a caret
 * popup. On select it either inserts a skillMention node or runs a command;
 * keyboard nav is delegated to React so the active index lives in one place.
 */
export const SlashSuggestion = Extension.create<SlashSuggestionOptions>({
  name: 'slashSuggestion',

  addOptions() {
    return { items: () => [], onChange: () => {}, onKeyDown: () => false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const view = (items: SlashEntry[], command: SuggestionView['command']) =>
      items.length > 0 ? { items, command } : null;
    return [
      Suggestion<SlashEntry, SlashEntry>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => options.items(query),
        command: ({ editor, range, props }) => {
          if (props.kind === 'skill') {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'skillMention', attrs: { name: props.item.name } },
                { type: 'text', text: ' ' },
              ])
              .run();
          } else {
            // A command: drop the typed `/query` and run its action — no chip.
            editor.chain().focus().deleteRange(range).run();
            props.item.run();
          }
        },
        render: () => ({
          onStart: (props) => options.onChange(view(props.items, props.command)),
          onUpdate: (props) => options.onChange(view(props.items, props.command)),
          onKeyDown: (props) => options.onKeyDown(props.event),
          onExit: () => options.onChange(null),
        }),
      }),
    ];
  },
});

/** Props to render the SlashMenu for the open suggestion. */
export type SlashMenuView = {
  items: SlashMenuItem[];
  activeIndex: number;
  onHoverIndex: (i: number) => void;
  onSelect: (item: SlashMenuItem) => void;
};

/** Case-insensitive filter on name or description (commands and skills alike). */
function filterByQuery<T extends { name: string; description: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
  );
}

/**
 * Wires the `/` menu to React. It discovers skills, merges in the caller's
 * commands, and owns the open-menu state behind refs — so the once-created
 * suggestion plugin always reads fresh values — returning the editor extensions
 * (skill node + suggestion) plus the props to render our SlashMenu. Keeps all
 * this plugin-bound plumbing out of the composer; `isOpen()` lets it defer keys.
 */
export function useSlashMenu(commands: SlashCommand[]): {
  extensions: Extensions;
  menu: SlashMenuView | null;
  isOpen: () => boolean;
} {
  const { data: skills } = trpc.skills.list.useQuery();
  const [view, setView] = useState<SuggestionView | null>(null);
  const [active, setActive] = useState(0);

  const skillsRef = useRef<SkillSuggestionItem[]>([]);
  skillsRef.current = skills ?? [];
  const commandsRef = useRef<SlashCommand[]>([]);
  commandsRef.current = commands;
  const viewRef = useRef<SuggestionView | null>(null);
  const activeRef = useRef(0);

  const setSuggestion = useCallback((next: SuggestionView | null) => {
    viewRef.current = next;
    activeRef.current = 0;
    setView(next);
    setActive(0);
  }, []);

  const setActiveIndex = useCallback((i: number) => {
    activeRef.current = i;
    setActive(i);
  }, []);

  // Arrow/Enter/Tab while open; reads refs so this once-captured handler stays fresh.
  const onKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const open = viewRef.current;
      if (!open) return false;
      if (event.key === 'ArrowDown') {
        setActiveIndex(Math.min(activeRef.current + 1, open.items.length - 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActiveIndex(Math.max(activeRef.current - 1, 0));
        return true;
      }
      // Tab accepts the active item like Enter: the menu is a completion popup, so
      // Tab should confirm the selection, not tab focus off the composer. Returning
      // true makes ProseMirror preventDefault, which suppresses the focus move.
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
        const entry = open.items[activeRef.current];
        if (entry) open.command(entry);
        return true;
      }
      return false;
    },
    [setActiveIndex],
  );

  const isOpen = useCallback(() => viewRef.current !== null, []);

  // Commands first, then skills — the menu shows commands above a "Skills" header.
  const items = useCallback((query: string): SlashEntry[] => {
    const cmds: SlashEntry[] = filterByQuery(commandsRef.current, query).map((item) => ({
      kind: 'command',
      item,
    }));
    const sks: SlashEntry[] = filterByQuery(skillsRef.current, query).map((item) => ({
      kind: 'skill',
      item,
    }));
    return [...cmds, ...sks];
  }, []);

  const extensions = useMemo<Extensions>(
    () => [SkillMention, SlashSuggestion.configure({ items, onChange: setSuggestion, onKeyDown })],
    [items, setSuggestion, onKeyDown],
  );

  const menu: SlashMenuView | null = view
    ? {
        items: view.items.map((e) =>
          e.kind === 'command'
            ? { name: e.item.name, desc: e.item.description, icon: e.item.icon, group: 'command' }
            : {
                name: e.item.name,
                desc: e.item.description,
                icon: Package,
                group: 'skill',
                tag: skillSourceLabel(e.item.source),
                skill: e.item.name,
              },
        ),
        activeIndex: active,
        onHoverIndex: setActiveIndex,
        onSelect: (item) => {
          const kind = item.group === 'command' ? 'command' : 'skill';
          const entry = view.items.find((e) => e.kind === kind && e.item.name === item.name);
          if (entry) view.command(entry);
        },
      }
    : null;

  return { extensions, menu, isOpen };
}
