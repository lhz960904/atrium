import { createFileRoute, Navigate, Outlet, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { trpc } from '../../lib/trpc';
import { useNavStore } from '../../state/nav-store';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const setLastAppPath = useNavStore((s) => s.setLastAppPath);
  const { data: settings, isLoading } = trpc.settings.all.useQuery();

  useEffect(() => {
    setLastAppPath(location.pathname);
  }, [location.pathname, setLastAppPath]);

  if (isLoading) return <div className="h-screen bg-canvas" />;
  if (settings && !settings.hasCompletedWelcome) return <Navigate to="/welcome" />;

  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <Sidebar />
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
