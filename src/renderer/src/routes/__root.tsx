import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AttachmentViewer } from '../components/AttachmentViewer';
import { CommandPalette } from '../components/CommandPalette';
import { Toaster } from '../components/Toaster';
import { trpc } from '../lib/trpc';
import { useKeybindings } from '../lib/use-keybindings';
import { useLanguage } from '../lib/use-language';
import { toast } from '../state/toast-store';

function Root(): React.JSX.Element {
  useLanguage(); // apply the persisted UI language on load
  useKeybindings(); // global app shortcuts (⌘K/⌘N/⌘B/⌘,)
  const navigate = useNavigate();

  // The menu-bar "New Chat" item routes the renderer to home (the new-chat screen).
  useEffect(() => {
    return window.electron?.ipcRenderer.on('menu:new-chat', () => {
      void navigate({ to: '/' });
    });
  }, [navigate]);

  // Clicking a scheduled-run notification reveals the task's bound conversation.
  useEffect(() => {
    return window.electron?.ipcRenderer.on('scheduled:open-thread', (_event, threadId: string) => {
      void navigate({ to: '/chat/$threadId', params: { threadId } });
    });
  }, [navigate]);

  // Once per launch, after startup connects settle, nudge the user if any MCP
  // server needs auth or failed — like Claude Code's "needs authorization" prompt.
  const attention = trpc.mcp.attention.useQuery(undefined, { refetchInterval: 4000 });
  const nudged = useRef(false);
  useEffect(() => {
    const count = attention.data?.length ?? 0;
    if (count === 0 || nudged.current) return;
    nudged.current = true;
    toast.warning(
      { key: 'settings.mcp.attentionToast', params: { count } },
      {
        label: { key: 'settings.mcp.attentionToastAction' },
        run: () => void navigate({ to: '/settings/$section', params: { section: 'mcp' } }),
      },
    );
  }, [attention.data, navigate]);

  return (
    <>
      <Outlet />
      <CommandPalette />
      <AttachmentViewer />
      <Toaster />
    </>
  );
}

export const Route = createRootRoute({ component: Root });
