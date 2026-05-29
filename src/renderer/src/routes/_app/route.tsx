import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { useNavStore } from '../../state/nav-store';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const setLastAppPath = useNavStore((s) => s.setLastAppPath);

  useEffect(() => {
    setLastAppPath(location.pathname);
  }, [location.pathname, setLastAppPath]);

  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <Sidebar />
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
