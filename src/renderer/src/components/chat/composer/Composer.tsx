import type { ComposerSendKey } from '@shared/settings';
import { useParams } from '@tanstack/react-router';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { Plus, Send, Square } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ATTACHMENT_ACCEPT,
  classifyAttachment,
  filesFromTransfer,
  pastedName,
} from '../../../lib/attachments';
import { useChatModel } from '../../../lib/use-chat-model';
import { useSetting } from '../../../lib/use-setting';
import { toast } from '../../../state/toast-store';
import { ModelPicker } from '../../ModelPicker';
import { PermissionPicker } from '../../PermissionPicker';
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
  /** Extra control rendered next to the attach button (e.g. the project picker). */
  toolbarLeft?: React.ReactNode;
  /** Status readout rendered just after the permission picker (e.g. the token counter). */
  toolbarStatus?: React.ReactNode;
};

/** True when the pressed Enter combo should send under the chosen mode; every
 *  other Enter combo falls through to a newline. ⌘ and Ctrl are interchangeable
 *  for 'mod' so the same binding works across platforms. */
function isSendCombo(event: KeyboardEvent, mode: ComposerSendKey): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (mode === 'mod') return mod && !event.shiftKey;
  if (mode === 'shift') return event.shiftKey && !mod;
  return !event.shiftKey && !mod;
}

export const Composer = memo(function Composer({
  autoFocus = false,
  placeholder,
  onSubmit,
  disabled = false,
  initialText = '',
  attachedTop = false,
  commands,
  streaming = false,
  onStop,
  toolbarLeft,
  toolbarStatus,
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [empty, setEmpty] = useState(initialText.trim().length === 0);
  const skill = useSlashMenu(commands ?? []);
  // No threadId on the home route → NEW_CHAT; the chat route supplies the id.
  const { threadId } = useParams({ strict: false });
  const { selected, setSelected, groups } = useChatModel(threadId);
  const { value: sendKey } = useSetting('general.composerSendKey');

  // The editor is created once, so handleKeyDown closes over the first render;
  // route Enter handling through refs so it sees the latest send fn + key mode.
  const sendRef = useRef<() => void>(() => {});
  const sendKeyRef = useRef<ComposerSendKey>(sendKey);
  sendKeyRef.current = sendKey;
  // handlePaste is captured once with the editor, so route file ingestion
  // through a ref that each render refreshes (mirrors sendRef).
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Resolved placeholder; t() recomputes this when the UI language changes. The
  // editor reads it live through a ref (extension config is captured once).
  const ph = placeholder ?? t('composer.placeholder');
  const phRef = useRef(ph);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: () => phRef.current }),
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
        if (event.key !== 'Enter') return false;
        if (isSendCombo(event, sendKeyRef.current)) {
          event.preventDefault();
          sendRef.current();
          return true;
        }
        // Every non-send Enter is a newline; insert a hard break ourselves and
        // consume the event so the same combo can't also split the paragraph.
        event.preventDefault();
        editorRef.current?.commands.setHardBreak();
        return true;
      },
      handlePaste: (_view, event) => {
        // Files on the clipboard (a pasted screenshot, a copied file) become
        // attachments; a plain text/HTML paste carries none, so fall through to
        // the editor's default paste.
        const files = filesFromTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        addFilesRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => setEmpty(editor.isEmpty),
  });
  editorRef.current = editor;

  // The extension's placeholder fn reads phRef; refresh it and recompute the
  // decoration when the resolved text changes (language/prop), so it isn't
  // frozen to the language active during the startup race.
  useEffect(() => {
    phRef.current = ph;
    editor?.view.dispatch(editor.state.tr);
  }, [editor, ph]);

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

  // Read each file into a data URL up front, so the attachment is a
  // self-contained copy (the original can move or be deleted) and maps straight
  // to an AI SDK file part on send. Shared by the file picker and clipboard paste.
  const addFiles = (files: File[]): void => {
    const dropped: string[] = [];
    for (const file of files) {
      const mediaType = classifyAttachment(file);
      if (mediaType === null) {
        dropped.push(file.name || t('common.attachment'));
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
            name: file.name || pastedName(mediaType),
            mediaType,
            url: `data:${mediaType};base64,${base64}`,
            size: file.size,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    if (dropped.length > 0) {
      toast.warning(t('composer.skippedFiles', { files: dropped.join(t('common.listSep')) }));
    }
  };
  addFilesRef.current = addFiles;

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same file be re-picked later
    addFiles(files);
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
          title={t('composer.attach')}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
        >
          <Plus className="size-[14px]" />
        </button>
        {toolbarLeft}
        <PermissionPicker />
        {toolbarStatus}
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
            title={t('composer.stop')}
            onClick={onStop}
            className="inline-flex size-7 items-center justify-center rounded-md bg-danger text-fg-on-accent hover:bg-danger/90"
          >
            <Square className="size-[11px]" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            title={t('composer.send')}
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-fg-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
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
});
