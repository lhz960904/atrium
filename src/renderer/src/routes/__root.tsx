import { createRootRoute, Outlet } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { AttachmentViewer } from '../components/AttachmentViewer';
import { CommandPalette } from '../components/CommandPalette';
import { Toaster } from '../components/Toaster';
import { useLanguage } from '../lib/use-language';

// Dev-only profiler overlay; lazy + DEV-gated so it never enters the prod bundle.
const PerfHud = import.meta.env.DEV
  ? lazy(() => import('../lib/dev/PerfHud').then((m) => ({ default: m.PerfHud })))
  : null;

function Root(): React.JSX.Element {
  useLanguage(); // apply the persisted UI language on load
  return (
    <>
      <Outlet />
      <CommandPalette />
      <AttachmentViewer />
      <Toaster />
      {PerfHud && (
        <Suspense fallback={null}>
          <PerfHud />
        </Suspense>
      )}
    </>
  );
}

export const Route = createRootRoute({ component: Root });
