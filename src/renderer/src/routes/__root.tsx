import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AttachmentViewer } from '../components/AttachmentViewer';
import { CommandPalette } from '../components/CommandPalette';
import { Toaster } from '../components/Toaster';
import { useLanguage } from '../lib/use-language';

function Root(): React.JSX.Element {
  useLanguage(); // apply the persisted UI language on load
  const navigate = useNavigate();

  // The menu-bar "New Chat" item routes the renderer to home (the new-chat screen).
  useEffect(() => {
    return window.electron?.ipcRenderer.on('menu:new-chat', () => {
      void navigate({ to: '/' });
    });
  }, [navigate]);

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
