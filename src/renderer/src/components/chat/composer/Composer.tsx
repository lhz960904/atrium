import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { Plus, Send, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, classifyAttachment } from '../../../lib/attachments';
import { useChatModel } from '../../../lib/use-chat-model';
import { toast } from '../../../state/toast-store';
import { ModelPicker } from '../../ModelPicker';
import { type Attachment, AttachmentChip } from './AttachmentChip';
import { SlashMenu } from './SlashMenu';
import { type SlashCommand, useSlashMenu } from './slash-menu';

type ComposerProps = {
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit?: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  initialText?: string;
  /** Square the top corners so the plan panel can sit flush on top of it. */
  attachedTop?: boolean;
  /** `/` commands offered alongside skills (e.g. compact); none by default. */
  commands?: SlashCommand[];
  /** A turn is generating — the send button becomes a stop button. */
  streaming?: boolean;
  /** Stop the in-flight generation (abort). */
  onStop?: () => void;
};

export function Composer({
  autoFocus = false,
  placeholder = '说点什么…',
  onSubmit,
  disabled = false,
  initialText = '',
  attachedTop = false,
  commands,
  streaming = false,
  onStop,
}: ComposerProps): React.JSX.Element {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [empty, setEmpty] = useState(initialText.trim().length === 0);
  const skill = useSlashMenu(commands ?? []);
  const { selected, setSelected, groups } = useChatModel();

  // The editor is created once, so handleKeyDown closes over the first render;
  // route Enter-to-send through a ref so it sees the latest state.
  const sendRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder }),
      ...skill.extensions,
    ],
    content: initialText,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'tiptap max-h-[200px] min-h-[28px] overflow-y-auto px-1 py-2 text-fg-primary',
      },
      handleKeyDown: (_view, event) => {
        // Defer all keys to the open suggestion (its onKeyDown selects/navigates).
        if (skill.isOpen()) return false;
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
  sendRef.current = handleSend;

  // Read each picked file into a data URL up front, so the attachment is a
  // self-contained copy (the original can move or be deleted) and maps straight
  // to an AI SDK file part on send.
  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same file be re-picked later
    const dropped: string[] = [];
    for (const file of files) {
      const mediaType = classifyAttachment(file);
      if (mediaType === null) {
        dropped.push(file.name);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        // The data URL's own media type wins over the part's mediaType field
        // downstream (convertToModelMessages reads it from the URL header), so
        // rebuild the URL with the classified type — e.g. an SVG read as text
        // must declare text/plain, not image/svg+xml, or the API rejects it.
        const base64 = reader.result.slice(reader.result.indexOf(',') + 1);
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name,
            mediaType,
            url: `data:${mediaType};base64,${base64}`,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    if (dropped.length > 0) {
      toast.warning(`已跳过暂不支持的文件：${dropped.join('、')}（转成文本或 PDF 后可传）`);
    }
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={onFilesPicked}
          className="hidden"
        />
        <button
          type="button"
          title="附件"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center rounded-md p-1.5 text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
        >
          <Plus className="size-[14px]" />
        </button>
        <span className="flex-1" />
        {/* refocus the editor after a model pick (popover steals focus) */}
        <ModelPicker
          value={selected}
          onChange={(v) => v && setSelected(v)}
          groups={groups}
          onSelected={() => requestAnimationFrame(() => editor?.commands.focus())}
        />
        {streaming ? (
          <button
            type="button"
            title="停止"
            onClick={onStop}
            className="rounded-md bg-danger p-1.5 text-fg-on-accent hover:bg-danger/90"
          >
            <Square className="size-[11px]" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            title="发送"
            onClick={handleSend}
            disabled={!canSend}
            className="rounded-md bg-accent p-1.5 text-fg-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
          >
            <Send className="size-[14px]" />
          </button>
        )}
      </div>

      {skill.menu && (
        <SlashMenu
          items={skill.menu.items}
          query=""
          activeIndex={skill.menu.activeIndex}
          onHoverIndex={skill.menu.onHoverIndex}
          onSelect={skill.menu.onSelect}
        />
      )}
    </div>
  );
}
