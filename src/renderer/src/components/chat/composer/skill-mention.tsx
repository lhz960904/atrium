import { Extension, type Extensions, Node } from '@tiptap/core';
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { Package } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { skillSourceLabel } from '../../../lib/skill-source';
import { trpc } from '../../../lib/trpc';
import type { SlashMenuItem } from './SlashMenu';

/**
 * The skill chip: an inline, atomic node the user inserts from the `/` menu, plus
 * the `/`-suggestion that inserts it. Kept in one file because the two are a
 * single feature — the suggestion only ever produces this node.
 */

// ── The chip node ───────────────────────────────────────────────────────────

/**
 * Inline atomic node rendered as a non-editable chip (icon + name); the cursor
 * can't enter it and backspace deletes it whole. On send it serializes
 * (renderText) to a directive that makes the model load the skill.
 */
export const SkillMention = Node.create({
  name: 'skillMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { name: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-skill-mention]' }];
  },

  // Serializes to a <skill-use> tag — the model reads it as an explicit
  // invocation and the message bubble (UserMessage) renders it back as a chip.
  // Keep this tag in sync with UserMessage's parser.
  renderHTML({ node }) {
    return [
      'span',
      { 'data-skill-mention': node.attrs.name },
      `<skill-use>${node.attrs.name}</skill-use>`,
    ];
  },

  renderText({ node }) {
    return `<skill-use>${node.attrs.name}</skill-use>`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillChip);
  },
});

function SkillChip({ node }: NodeViewProps): React.JSX.Element {
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="select-none font-medium text-accent"
    >
      <Package className="mr-1 inline size-3.5 align-middle" />
      {node.attrs.name}
    </NodeViewWrapper>
  );
}

// ── The `/` suggestion that inserts the chip ────────────────────────────────

export type SkillSuggestionItem = { name: string; description: string; source: string };

/** What the React layer needs to render and act on the open suggestion. */
export type SuggestionView = {
  items: SkillSuggestionItem[];
  command: (item: SkillSuggestionItem) => void;
};

export type SkillSuggestionOptions = {
  /** Filter the available skills for the current query (caller reads fresh state). */
  items: (query: string) => SkillSuggestionItem[];
  /** The suggestion opened/updated (a view), or closed (null) — handed to React. */
  onChange: (view: SuggestionView | null) => void;
  /** Arrow/Enter while open — React handles nav/select, returns whether handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

/**
 * A `/`-triggered suggestion bridged to our own React dropdown (SlashMenu,
 * anchored at the composer bottom) rather than a caret popup. On select it
 * inserts a skillMention node at the trigger range; keyboard nav is delegated to
 * React so the active index lives in one place.
 */
export const SkillSuggestion = Extension.create<SkillSuggestionOptions>({
  name: 'skillSuggestion',

  addOptions() {
    return { items: () => [], onChange: () => {}, onKeyDown: () => false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const view = (items: SkillSuggestionItem[], command: SuggestionView['command']) =>
      items.length > 0 ? { items, command } : null;
    return [
      Suggestion<SkillSuggestionItem, SkillSuggestionItem>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => options.items(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'skillMention', attrs: { name: props.name } },
              { type: 'text', text: ' ' },
            ])
            .run();
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

// ── React integration ───────────────────────────────────────────────────────

/** Props to render the SlashMenu for the open suggestion. */
export type SkillSuggestionMenu = {
  items: SlashMenuItem[];
  activeIndex: number;
  onHoverIndex: (i: number) => void;
  onSelect: (item: SlashMenuItem) => void;
};

function filterSkills(skills: SkillSuggestionItem[], query: string): SkillSuggestionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  );
}

/**
 * Wires the skill chip node + `/` suggestion to React. It discovers skills and
 * owns the open-menu state behind refs — so the once-created suggestion plugin
 * always reads fresh values — and returns the editor extensions plus the props
 * to render our SlashMenu. Keeps all this plugin-bound plumbing out of the
 * composer; `isOpen()` lets the composer defer keys to the menu when it's up.
 */
export function useSkillSuggestion(): {
  extensions: Extensions;
  menu: SkillSuggestionMenu | null;
  isOpen: () => boolean;
} {
  const { data: skills } = trpc.skills.list.useQuery();
  const [view, setView] = useState<SuggestionView | null>(null);
  const [active, setActive] = useState(0);

  const skillsRef = useRef<SkillSuggestionItem[]>([]);
  skillsRef.current = skills ?? [];
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

  // Arrow/Enter while open; reads refs so this once-captured handler stays fresh.
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
      if (event.key === 'Enter') {
        const item = open.items[activeRef.current];
        if (item) open.command(item);
        return true;
      }
      return false;
    },
    [setActiveIndex],
  );

  const isOpen = useCallback(() => viewRef.current !== null, []);

  const extensions = useMemo<Extensions>(
    () => [
      SkillMention,
      SkillSuggestion.configure({
        items: (query) => filterSkills(skillsRef.current, query),
        onChange: setSuggestion,
        onKeyDown,
      }),
    ],
    [setSuggestion, onKeyDown],
  );

  const menu: SkillSuggestionMenu | null = view
    ? {
        items: view.items.map((s) => ({
          name: s.name,
          desc: s.description,
          icon: Package,
          group: 'skill',
          tag: skillSourceLabel(s.source),
          skill: s.name,
        })),
        activeIndex: active,
        onHoverIndex: setActiveIndex,
        onSelect: (item) => {
          const orig = view.items.find((s) => s.name === item.skill);
          if (orig) view.command(orig);
        },
      }
    : null;

  return { extensions, menu, isOpen };
}
