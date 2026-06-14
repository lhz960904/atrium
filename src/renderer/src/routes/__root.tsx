import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AttachmentViewer } from '../components/AttachmentViewer';
import { CommandPalette } from '../components/CommandPalette';
import { Toaster } from '../components/Toaster';
import { useLanguage } from '../lib/use-language';

function Root(): React.JSX.Element {
  useLanguage(); // apply the persisted UI language on load
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
