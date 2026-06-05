import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { ArrowUp, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { type Attachment, AttachmentChip } from './AttachmentChip';
import { ModelPicker } from './ModelPicker';

type ComposerProps = {
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit?: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  initialText?: string;
  /** Square the top corners so the plan panel can sit flush on top of it. */
  attachedTop?: boolean;
};

export function Composer({
  autoFocus = false,
  placeholder = '说点什么…',
  onSubmit,
  disabled = false,
  initialText = '',
  attachedTop = false,
}: ComposerProps): React.JSX.Element {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [empty, setEmpty] = useState(initialText.trim().length === 0);
  // The editor is created once, so its handleKeyDown closes over the first
  // render's state. Route Enter-to-send through a ref that always points at the
  // latest handleSend, so it reads current attachments/disabled, not stale ones.
  const sendRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      // Shift-Enter / Mod-Enter insert a newline; plain Enter is intercepted to send.
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder }),
    ],
    content: initialText,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'tiptap max-h-[200px] min-h-[28px] overflow-y-auto px-1 py-2 text-fg-primary',
      },
      handleKeyDown: (_view, event) => {
        // IME composing (e.g. pinyin): Enter confirms the candidate, never sends.
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => setEmpty(editor.isEmpty),
  });

  const handleSend = (): void => {
    if (disabled || !editor) return;
    const text = editor.getText({ blockSeparator: '\n' });
    if (text.trim().length === 0 && attachments.length === 0) return;
    onSubmit?.(text, attachments);
    editor.commands.clearContent();
    setEmpty(true);
    setAttachments([]);
  };
  // Keep the ref current so the editor's captured handleKeyDown sends fresh state.
  sendRef.current = handleSend;

  const addMockAttachment = (): void => {
    const candidates = ['screenshot.png', 'notes.md', 'design.pdf', 'sketch.png'];
    const name = candidates[attachments.length % candidates.length];
    if (!name) return;
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}`, name }]);
  };

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const canSend = !disabled && (!empty || attachments.length > 0);

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

      <EditorContent editor={editor} />

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
        {/* refocus the editor after a model pick (popover steals focus) */}
        <ModelPicker onSelected={() => requestAnimationFrame(() => editor?.commands.focus())} />
        <button
          type="button"
          title="发送"
          onClick={handleSend}
          disabled={!canSend}
          className="rounded-md bg-accent p-1.5 text-fg-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          <ArrowUp className="size-[14px]" />
        </button>
      </div>
    </div>
  );
}
