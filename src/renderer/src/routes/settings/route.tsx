import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

const NAV_ITEMS = [
  { section: 'general', label: 'General' },
  { section: 'appearance', label: 'Appearance' },
  { section: 'providers', label: 'Providers' },
  { section: 'subagents', label: 'Subagents' },
  { section: 'permissions', label: 'Permissions' },
  { section: 'memories', label: 'Memories' },
  { section: 'about', label: 'About' },
] as const;

function SettingsLayout(): React.JSX.Element {
  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-border-default bg-surface">
        <div className="atrium-titlebar" />
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <Link
            to="/"
            className="mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-fg-tertiary text-sm hover:bg-surface-strong hover:text-fg-primary"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.section}
              to="/settings/$section"
              params={{ section: item.section }}
              className="rounded-md px-3 py-2 text-sm text-fg-secondary hover:bg-surface-strong hover:text-fg-primary"
              activeProps={{
                className: 'rounded-md px-3 py-2 text-sm bg-elevated text-fg-primary',
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
