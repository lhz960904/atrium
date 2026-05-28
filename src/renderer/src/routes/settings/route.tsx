import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  Atom,
  Brain,
  Info,
  Layers,
  type LucideIcon,
  Shield,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import { useNavStore } from '../../state/nav-store';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

type NavItem = {
  section: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: readonly NavItem[] = [
  { section: 'general', label: 'General', icon: SlidersHorizontal },
  { section: 'appearance', label: 'Appearance', icon: Sun },
  { section: 'providers', label: 'Providers', icon: Layers },
  { section: 'subagents', label: 'Subagents', icon: Atom },
  { section: 'permissions', label: 'Permissions', icon: Shield },
  { section: 'memories', label: 'Memories', icon: Brain },
  { section: 'about', label: 'About', icon: Info },
];

function SettingsLayout(): React.JSX.Element {
  const navigate = useNavigate();
  const lastAppPath = useNavStore((s) => s.lastAppPath);

  const goBackToApp = (): void => {
    // TanStack Router navigate({ to }) strictly matches typed routes at
    // runtime — passing a dynamic string with a type-cast doesn't actually
    // navigate to it. Parse the path back into typed nav options here.
    const chatMatch = lastAppPath.match(/^\/chat\/(.+)$/);
    if (chatMatch) {
      navigate({ to: '/chat/$threadId', params: { threadId: chatMatch[1] } });
    } else {
      navigate({ to: '/' });
    }
  };

  return (
    <div className="grid h-screen grid-cols-[260px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-border-default bg-surface">
        <div className="atrium-titlebar" />
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          <button
            type="button"
            onClick={goBackToApp}
            className="mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-fg-tertiary text-sm hover:bg-surface-strong hover:text-fg-primary"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </button>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.section}
                to="/settings/$section"
                params={{ section: item.section }}
                className="group flex items-center gap-3 rounded-md px-3 py-2 text-fg-secondary text-sm hover:bg-surface-strong hover:text-fg-primary"
                activeProps={{
                  className:
                    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm bg-elevated text-fg-primary [&_svg]:text-accent',
                }}
              >
                <Icon className="size-[15px] shrink-0 text-fg-tertiary group-hover:text-fg-secondary" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>
      <main className="min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
