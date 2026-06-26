import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  Anchor,
  AppWindow,
  Archive,
  ArrowLeft,
  Atom,
  Box,
  Brain,
  Fingerprint,
  Gauge,
  GitBranch,
  Globe,
  Info,
  Keyboard,
  Layers,
  type LucideIcon,
  MousePointerClick,
  Package,
  PawPrint,
  Server,
  Shield,
  SlidersHorizontal,
  Sun,
  Waypoints,
} from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavStore } from '../../state/nav-store';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

type NavGroup = 'personal' | 'integrations' | 'coding' | 'archived';

type NavItem = {
  section: string;
  labelKey: ParseKeys;
  icon: LucideIcon;
  /** Heading the item sits under; ungrouped items render after all groups. */
  group?: NavGroup;
};

const GROUP_LABELS: Record<NavGroup, ParseKeys> = {
  personal: 'settings.groups.personal',
  integrations: 'settings.groups.integrations',
  coding: 'settings.groups.coding',
  archived: 'settings.groups.archived',
};

// Sections without a live page route to a placeholder for now; they hold the
// shape of the settings IA until each is built out.
const NAV_ITEMS: readonly NavItem[] = [
  {
    section: 'general',
    labelKey: 'settings.sections.generalTitle',
    icon: SlidersHorizontal,
    group: 'personal',
  },
  {
    section: 'identity',
    labelKey: 'settings.sections.identityTitle',
    icon: Fingerprint,
    group: 'personal',
  },
  {
    section: 'appearance',
    labelKey: 'settings.sections.appearanceTitle',
    icon: Sun,
    group: 'personal',
  },
  {
    section: 'memories',
    labelKey: 'settings.sections.memoriesTitle',
    icon: Brain,
    group: 'personal',
  },
  { section: 'pets', labelKey: 'settings.sections.petsTitle', icon: PawPrint, group: 'personal' },
  {
    section: 'keyboard',
    labelKey: 'settings.sections.keyboardTitle',
    icon: Keyboard,
    group: 'personal',
  },
  { section: 'usage', labelKey: 'settings.sections.usageTitle', icon: Gauge, group: 'personal' },
  {
    section: 'providers',
    labelKey: 'settings.sections.providersTitle',
    icon: Layers,
    group: 'integrations',
  },
  {
    section: 'skills',
    labelKey: 'settings.sections.skillsTitle',
    icon: Package,
    group: 'integrations',
  },
  {
    section: 'subagents',
    labelKey: 'settings.sections.subagentsTitle',
    icon: Atom,
    group: 'integrations',
  },
  { section: 'mcp', labelKey: 'settings.sections.mcpTitle', icon: Server, group: 'integrations' },
  {
    section: 'browser',
    labelKey: 'settings.sections.browserTitle',
    icon: AppWindow,
    group: 'integrations',
  },
  {
    section: 'computer',
    labelKey: 'settings.sections.computerTitle',
    icon: MousePointerClick,
    group: 'integrations',
  },
  {
    section: 'permissions',
    labelKey: 'settings.sections.permissionsTitle',
    icon: Shield,
    group: 'coding',
  },
  { section: 'hooks', labelKey: 'settings.sections.hooksTitle', icon: Anchor, group: 'coding' },
  {
    section: 'connections',
    labelKey: 'settings.sections.connectionsTitle',
    icon: Globe,
    group: 'coding',
  },
  { section: 'git', labelKey: 'settings.sections.gitTitle', icon: GitBranch, group: 'coding' },
  {
    section: 'environments',
    labelKey: 'settings.sections.environmentsTitle',
    icon: Box,
    group: 'coding',
  },
  {
    section: 'worktrees',
    labelKey: 'settings.sections.worktreesTitle',
    icon: Waypoints,
    group: 'coding',
  },
  {
    section: 'archived',
    labelKey: 'settings.sections.archivedTitle',
    icon: Archive,
    group: 'archived',
  },
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
            className="mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-fg-tertiary text-sm hover:bg-surface-strong hover:text-fg-primary"
          >
            <ArrowLeft className="size-3.5" />
            {t('settings.backToApp')}
          </button>
          {NAV_ITEMS.map((item, i) => {
            const Icon = item.icon;
            const showHeader = item.group != null && item.group !== NAV_ITEMS[i - 1]?.group;
            return (
              <Fragment key={item.section}>
                {showHeader && item.group && (
                  <div
                    className={`px-3 pb-1 font-medium text-[10.5px] text-fg-tertiary uppercase tracking-wider ${
                      i === 0 ? 'pt-1' : 'pt-4'
                    }`}
                  >
                    {t(GROUP_LABELS[item.group])}
                  </div>
                )}
                <Link
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
              </Fragment>
            );
          })}
        </div>
      </aside>
      <main className="relative flex min-w-0 flex-col overflow-hidden">
        {/* Top 36px only ever shows the section title, so a drag strip is safe here. */}
        <div className="app-drag absolute inset-x-0 top-0 z-10 h-9" />
        <Outlet />
      </main>
    </div>
  );
}
