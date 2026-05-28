import { ArrowUp, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type Attachment, AttachmentChip } from './AttachmentChip';
import { MENTION_ITEMS, SLASH_COMMANDS, SlashMenu, type SlashMenuItem } from './SlashMenu';

type MenuState = {
  kind: 'slash' | 'mention';
  query: string;
  activeIndex: number;
};

/**
 * Detect whether the cursor is currently inside a slash- or @-command.
 * Trigger char must be at the start of the textarea or preceded by whitespace
 * (so URLs like https://… don't open the menu).
 */
function detectMenuTrigger(
  text: string,
  cursor: number,
): { kind: 'slash' | 'mention'; query: string } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '/' || c === '@') {
      const before = i === 0 ? '' : text[i - 1];
      if (before === '' || /\s/.test(before)) {
        return { kind: c === '/' ? 'slash' : 'mention', query: text.slice(i + 1, cursor) };
      }
      return null;
    }
    if (c && /\s/.test(c)) return null;
  }
  return null;
}

export function Composer({
  autoFocus = false,
  placeholder = '说点什么…',
}: {
  autoFocus?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Autosize: grow textarea up to ~200px, then scroll internally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text drives autosize via scrollHeight (indirect dep)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const updateMenuFromCursor = (newText: string, cursor: number): void => {
    const trigger = detectMenuTrigger(newText, cursor);
    if (trigger) {
      setMenu({ kind: trigger.kind, query: trigger.query, activeIndex: 0 });
    } else {
      setMenu(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const newText = e.target.value;
    setText(newText);
    updateMenuFromCursor(newText, e.target.selectionStart);
  };

  const handleSend = (): void => {
    if (text.trim().length === 0 && attachments.length === 0) return;
    // Send is a stub for now — agent loop lands later.
    console.log('Send:', { text, attachments });
    setText('');
    setAttachments([]);
    setMenu(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenu({ ...menu, activeIndex: menu.activeIndex + 1 });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenu({ ...menu, activeIndex: Math.max(0, menu.activeIndex - 1) });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addMockAttachment = (): void => {
    const candidates = ['screenshot.png', 'notes.md', 'design.pdf', 'sketch.png'];
    const name = candidates[attachments.length % candidates.length];
    if (!name) return;
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}`, name }]);
  };

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleMenuSelect = (_item: SlashMenuItem): void => {
    // Stub: real command dispatching lands when each slash command earns
    // its own implementation.
    setMenu(null);
    taRef.current?.focus();
  };

  const menuItems = menu?.kind === 'slash' ? SLASH_COMMANDS : MENTION_ITEMS;

  return (
    <div className="relative rounded-xl border border-border-default bg-surface p-3 transition-colors focus-within:border-accent">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onRemove={removeAttachment} />
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="block max-h-[200px] min-h-[28px] w-full resize-none border-0 bg-transparent px-1 py-2 text-fg-primary outline-0 placeholder:text-fg-disabled"
      />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          title="附件"
          onClick={addMockAttachment}
          className="inline-flex items-center rounded-md p-1.5 text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
        >
          <Plus className="size-[14px]" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-fg-tertiary text-sm hover:bg-elevated hover:text-fg-secondary"
        >
          <span>Opus 4.7</span>
          <ChevronDown className="size-[14px]" />
        </button>
        <button
          type="button"
          title="发送"
          onClick={handleSend}
          disabled={text.trim().length === 0 && attachments.length === 0}
          className="rounded-md bg-accent p-1.5 text-fg-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          <ArrowUp className="size-[14px]" />
        </button>
      </div>

      {menu && (
        <SlashMenu
          items={menuItems}
          query={menu.query}
          activeIndex={menu.activeIndex}
          onHoverIndex={(i) => setMenu({ ...menu, activeIndex: i })}
          onSelect={handleMenuSelect}
        />
      )}
    </div>
  );
}
