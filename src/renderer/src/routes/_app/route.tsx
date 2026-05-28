import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '../../components/Sidebar';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout(): React.JSX.Element {
  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <Sidebar />
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
