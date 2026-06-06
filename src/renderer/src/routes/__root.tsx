import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from '../components/Toaster';

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
});
