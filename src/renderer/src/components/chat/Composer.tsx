import { ArrowUp, Package, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { skillSourceLabel } from '../../lib/skill-source';
import { trpc } from '../../lib/trpc';
import { type Attachment, AttachmentChip } from './AttachmentChip';
import { ModelPicker } from './ModelPicker';
import { SLASH_COMMANDS, SlashMenu, type SlashMenuItem } from './SlashMenu';

type MenuState = {
  query: string;
  activeIndex: number;
};

/**
 * Detect whether the cursor is currently inside a slash command. The `/` must
 * be at the start of the textarea or preceded by whitespace (so URLs like
 * https://… don't open the menu).
 */
function detectSlashTrigger(text: string, cursor: number): { query: string } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '/') {
      const before = i === 0 ? '' : text[i - 1];
      if (before === '' || /\s/.test(before)) return { query: text.slice(i + 1, cursor) };
      return null;
    }
    if (c && /\s/.test(c)) return null;
  }
  return null;
}

export function Composer({
  autoFocus = false,
  placeholder = '说点什么…',
  onSubmit,
  disabled = false,
  initialText = '',
  attachedTop = false,
}: {
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit?: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  initialText?: string;
  /** Square the top corners so the plan panel can sit flush on top of it. */
  attachedTop?: boolean;
}): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { data: skills } = trpc.skills.list.useQuery();

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
    const trigger = detectSlashTrigger(newText, cursor);
    if (trigger) {
      setMenu({ query: trigger.query, activeIndex: 0 });
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
    if (disabled) return;
    if (text.trim().length === 0 && attachments.length === 0) return;
    if (onSubmit) {
      onSubmit(text, attachments);
    } else {
      console.log('Send:', { text, attachments });
    }
    setText('');
    setAttachments([]);
    setMenu(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // While an IME is composing (e.g. typing pinyin), Enter confirms the
    // candidate — it must never send or steer the slash menu.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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

  // Replace the open `/trigger` token with a skill-invocation intent. Sending
  // it makes the model load the skill via the skill tool (the user-invocable
  // path, alongside the model invoking skills on its own).
  const invokeSkill = (skillName: string): void => {
    const ta = taRef.current;
    const cursor = ta?.selectionStart ?? text.length;
    let start = cursor;
    for (let i = cursor - 1; i >= 0; i--) {
      if (text[i] === '/') {
        start = i;
        break;
      }
      if (/\s/.test(text[i] ?? '')) break;
    }
    const intent = `Use the ${skillName} skill: `;
    const next = text.slice(0, start) + intent + text.slice(cursor);
    setText(next);
    setMenu(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + intent.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  const handleMenuSelect = (item: SlashMenuItem): void => {
    if (item.skill) {
      invokeSkill(item.skill);
      return;
    }
    // App commands are still stubs — each lands its dispatch when implemented.
    setMenu(null);
    taRef.current?.focus();
  };

  const skillItems: SlashMenuItem[] = (skills ?? []).map((s) => ({
    name: s.name,
    desc: s.description,
    icon: Package,
    group: 'skill',
    tag: skillSourceLabel(s.source),
    skill: s.name,
  }));
  const menuItems = [...SLASH_COMMANDS, ...skillItems];

  return (
    <div
      className={`relative border border-border-default bg-surface p-3 transition-colors focus-within:border-accent ${
        attachedTop ? 'rounded-b-xl' : 'rounded-xl'
      }`}
    >
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
        {/* refocus the textarea after a model pick (popover steals focus) */}
        <ModelPicker onSelected={() => requestAnimationFrame(() => taRef.current?.focus())} />
        <button
          type="button"
          title="发送"
          onClick={handleSend}
          disabled={disabled || (text.trim().length === 0 && attachments.length === 0)}
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
