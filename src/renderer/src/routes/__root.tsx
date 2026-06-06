import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AttachmentViewer } from '../components/AttachmentViewer';
import { Toaster } from '../components/Toaster';

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <AttachmentViewer />
      <Toaster />
    </>
  ),
});
