import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import {
  type LucideIcon,
  MessageSquare,
  Moon,
  Search,
  Settings,
  SquarePen,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { timeAgo } from '../lib/time';
import { trpc } from '../lib/trpc';
import { useCommandPalette } from '../state/command-palette-store';
import { useThemeStore } from '../state/theme-store';
import { SnippetText } from './SearchSnippet';

/** Debounce before hitting the FTS query so each keystroke doesn't fire one. */
const SEARCH_DEBOUNCE_MS = 220;

type PaletteCommand = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Extra terms to match against (the visible label may be localized/dynamic). */
  keywords: string[];
  run: () => void;
};

/**
 * The ⌘K command palette: a single surface for both quick commands and chat
 * search. cmdk owns keyboard nav/selection; we own filtering (commands matched
 * locally, chats ranked by the FTS backend) so `shouldFilter` stays off.
 */
export function CommandPalette(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);

  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const setTheme = useThemeStore((s) => s.setTheme);

  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const close = (): void => {
    setOpen(false);
    setInput('');
    setDebounced('');
  };

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'toggle-theme',
        label: isDark ? t('commandPalette.toLight') : t('commandPalette.toDark'),
        icon: isDark ? Sun : Moon,
        keywords: ['theme', '主题', 'dark', 'light', '深色', '浅色', '切换', 'appearance'],
        run: () => setTheme(isDark ? 'light' : 'dark'),
      },
      {
        id: 'new-chat',
        label: t('commandPalette.newChat'),
        icon: SquarePen,
        keywords: ['new', 'chat', '新建', '对话', '新对话'],
        run: () => navigate({ to: '/' }),
      },
      {
        id: 'settings',
        label: t('commandPalette.openSettings'),
        icon: Settings,
        keywords: ['settings', '设置', 'preferences'],
        run: () => navigate({ to: '/settings/$section', params: { section: 'general' } }),
      },
    ],
    [isDark, setTheme, navigate, t],
  );

  const q = input.trim().toLowerCase();
  const visibleCommands = q
    ? commands.filter(
        (c) => c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)),
      )
    : commands;

  const { data } = trpc.search.chats.useQuery(
    { query: debounced, scope: 'active' },
    { keepPreviousData: true, enabled: open },
  );
  const hits = data?.hits ?? [];
  const isRecent = debounced.trim() === '';

  const runCommand = (fn: () => void): void => {
    close();
    fn();
  };

  const openChat = (threadId: string): void => {
    close();
    navigate({ to: '/chat/$threadId', params: { threadId } });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="-translate-x-1/2 fixed top-[12vh] left-1/2 z-[var(--z-modal)] flex w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-xl outline-none"
        >
          <Dialog.Title className="sr-only">{t('sidebar.search')}</Dialog.Title>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex shrink-0 items-center gap-2 border-border-default border-b px-3.5">
              <Search className="size-[15px] shrink-0 text-fg-tertiary" />
              <Command.Input
                value={input}
                onValueChange={setInput}
                placeholder={t('commandPalette.placeholder')}
                className="flex-1 border-0 bg-transparent py-3 text-fg-primary text-sm outline-0 placeholder:text-fg-disabled"
              />
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:text-fg-tertiary [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
              <Command.Empty className="px-3 py-8 text-center text-fg-tertiary text-sm">
                {t('commandPalette.empty')}
              </Command.Empty>

              {visibleCommands.length > 0 && (
                <Command.Group heading={t('commandPalette.groupCommands')}>
                  {visibleCommands.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`cmd:${c.id}`}
                      onSelect={() => runCommand(c.run)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-fg-secondary text-sm data-[selected=true]:bg-surface-strong data-[selected=true]:text-fg-primary"
                    >
                      <c.icon className="size-4 shrink-0 text-fg-tertiary" />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {hits.length > 0 && (
                <Command.Group
                  heading={
                    isRecent ? t('commandPalette.groupRecent') : t('commandPalette.groupChats')
                  }
                >
                  {hits.map((h) => (
                    <Command.Item
                      key={h.threadId}
                      value={`chat:${h.threadId}`}
                      onSelect={() => openChat(h.threadId)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-surface-strong"
                    >
                      <MessageSquare className="size-4 shrink-0 text-fg-tertiary" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-fg-primary">
                          {h.matchedIn === 'title' && h.snippet ? (
                            <SnippetText snippet={h.snippet} />
                          ) : (
                            (h.title ?? t('common.untitledChat'))
                          )}
                        </span>
                        {h.matchedIn === 'message' && h.snippet && (
                          <span className="truncate text-fg-tertiary text-xs">
                            <SnippetText snippet={h.snippet} />
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-fg-disabled text-xs">
                        {timeAgo(h.updatedAt)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
