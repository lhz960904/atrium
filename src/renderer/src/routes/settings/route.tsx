import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  ArrowLeft,
  Atom,
  Brain,
  Fingerprint,
  Info,
  Layers,
  type LucideIcon,
  Package,
  Shield,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavStore } from '../../state/nav-store';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

type NavItem = {
  section: string;
  labelKey: ParseKeys;
  icon: LucideIcon;
};

const NAV_ITEMS: readonly NavItem[] = [
  { section: 'general', labelKey: 'settings.sections.generalTitle', icon: SlidersHorizontal },
  { section: 'appearance', labelKey: 'settings.sections.appearanceTitle', icon: Sun },
  { section: 'providers', labelKey: 'settings.sections.providersTitle', icon: Layers },
  { section: 'skills', labelKey: 'settings.sections.skillsTitle', icon: Package },
  { section: 'subagents', labelKey: 'settings.sections.subagentsTitle', icon: Atom },
  { section: 'permissions', labelKey: 'settings.sections.permissionsTitle', icon: Shield },
  { section: 'identity', labelKey: 'settings.sections.identityTitle', icon: Fingerprint },
  { section: 'memories', labelKey: 'settings.sections.memoriesTitle', icon: Brain },
  { section: 'about', labelKey: 'settings.sections.aboutTitle', icon: Info },
];

function SettingsLayout(): React.JSX.Element {
  const { t } = useTranslation();
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
            {t('settings.backToApp')}
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
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </aside>
      <main className="relative min-w-0 overflow-y-auto">
        {/* Top 36px only ever shows the section title, so a drag strip is safe here. */}
        <div className="app-drag absolute inset-x-0 top-0 z-10 h-9" />
        <Outlet />
      </main>
    </div>
  );
}
