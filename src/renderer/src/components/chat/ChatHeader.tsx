import * as Popover from '@radix-ui/react-popover';
import type { AtriumUIMessage } from '@shared/chat';
import { exportFilename, renderChatMarkdown } from '@shared/chat-markdown';
import { useNavigate } from '@tanstack/react-router';
import { Archive, Copy, Ellipsis, FileDown, Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { useSidebarStore } from '../../state/sidebar-store';
import { toast } from '../../state/toast-store';

const menuItem =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-fg-secondary text-sm hover:bg-surface-strong';

export function ChatHeader({
  threadId,
  title,
}: {
  threadId: string;
  title: string;
}): React.JSX.Element {
  // Left-aligned; when collapsed, pad clear of the floating toggle at top-left.
  const collapsed = useSidebarStore((s) => s.collapsed);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Enter/Escape settle the edit, then unmount the input — guard so the
  // trailing blur can't settle a second time (double-write or commit-on-cancel).
  const settling = useRef(false);

  const rename = trpc.threads.updateTitle.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.threads.get.invalidate({ id: threadId }),
        utils.threads.list.invalidate(),
      ]),
  });
  const archive = trpc.threads.archive.useMutation({
    onSuccess: async () => {
      await utils.threads.list.invalidate();
      toast.success(t('chat.archived'));
      navigate({ to: '/' });
    },
  });
  const saveFile = trpc.system.saveTextFile.useMutation();

  // Both actions read the DB (not the mounted chat state) so the full history
  // is exported even while a turn streams or the view holds a truncated list.
  const buildMarkdown = async (): Promise<string> => {
    const rows = await utils.messages.listByThread.fetch({ threadId });
    const messages = rows.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      metadata: m.metadata ?? undefined,
    })) as AtriumUIMessage[];
    return renderChatMarkdown({
      title,
      messages,
      labels: {
        user: t('chat.exportUser'),
        assistant: t('chat.exportAssistant'),
        tools: (count) => t('chat.exportTools', { count }),
        image: (name) => (name ? `${t('chat.exportImage')}: ${name}` : t('chat.exportImage')),
      },
    });
  };

  const copyAll = async (): Promise<void> => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(await buildMarkdown());
      toast.success(t('chat.copiedAll'));
    } catch {
      // Clipboard write can be refused (e.g. unfocused document) — surface it.
      toast.error(t('chat.copyFailed'));
    }
  };

  const exportMarkdown = async (): Promise<void> => {
    setMenuOpen(false);
    try {
      const content = await buildMarkdown();
      const path = await saveFile.mutateAsync({
        defaultName: `${exportFilename(title)}.md`,
        content,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (path) toast.success(t('chat.exported', { path }));
    } catch {
      toast.error(t('chat.exportFailed'));
    }
  };

  const startRename = (): void => {
    setMenuOpen(false);
    setDraft(title);
    settling.current = false;
    setEditing(true);
  };
  // Settle the edit exactly once. Commit (Enter/blur) only writes when the name
  // actually changed; cancel (Escape) discards.
  const settle = (commit: boolean): void => {
    if (settling.current) return;
    settling.current = true;
    setEditing(false);
    const next = draft.trim();
    if (commit && next && next !== title) rename.mutate({ id: threadId, title: next });
  };

  return (
    <header
      className={`app-drag flex shrink-0 items-center gap-1.5 border-border-default border-b py-3 pr-6 transition-[padding] duration-200 ${
        collapsed ? 'pl-[120px]' : 'pl-6'
      }`}
    >
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: the rename field should take focus the moment it opens
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              settle(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              settle(false);
            }
          }}
          onBlur={() => settle(true)}
          className="app-no-drag w-1/2 min-w-0 rounded-md border border-accent bg-surface px-2 py-0.5 font-medium text-fg-primary text-md outline-0"
        />
      ) : (
        <>
          <h1 className="app-no-drag min-w-0 truncate font-medium text-fg-primary text-md">
            {title}
          </h1>
          <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                title={t('chat.more')}
                aria-label={t('chat.more')}
                className="app-no-drag shrink-0 rounded-md p-1 text-fg-tertiary hover:bg-elevated hover:text-fg-secondary"
              >
                <Ellipsis className="size-[18px]" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                className="z-50 w-44 rounded-lg border border-border-default bg-elevated p-1 shadow-lg"
              >
                <button type="button" onClick={startRename} className={menuItem}>
                  <Pencil className="size-[14px] shrink-0 text-fg-tertiary" />
                  {t('chat.rename')}
                </button>
                <button type="button" onClick={() => void copyAll()} className={menuItem}>
                  <Copy className="size-[14px] shrink-0 text-fg-tertiary" />
                  {t('chat.copyAll')}
                </button>
                <button type="button" onClick={() => void exportMarkdown()} className={menuItem}>
                  <FileDown className="size-[14px] shrink-0 text-fg-tertiary" />
                  {t('chat.exportMarkdown')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    archive.mutate({ id: threadId });
                  }}
                  className={menuItem}
                >
                  <Archive className="size-[14px] shrink-0 text-fg-tertiary" />
                  {t('chat.archive')}
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </>
      )}
    </header>
  );
}
