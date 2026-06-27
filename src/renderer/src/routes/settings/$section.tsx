import { createFileRoute, notFound } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import { ArchivedSection } from '../../components/settings/archived/ArchivedSection';
import { IdentitySection } from '../../components/settings/identity/IdentitySection';
import { MemoriesSection } from '../../components/settings/memories/MemoriesSection';
import { PermissionsSection } from '../../components/settings/permissions/PermissionsSection';
import { EnableSwitch } from '../../components/settings/providers/EnableSwitch';
import { ProvidersSection } from '../../components/settings/providers/ProvidersSection';
import { SkillsSection } from '../../components/settings/skills/SkillsSection';
import { SubagentsSection } from '../../components/settings/subagents/SubagentsSection';
import { UsageSection } from '../../components/settings/usage/UsageSection';
import { trpc } from '../../lib/trpc';
import { type LanguagePref, useLanguage } from '../../lib/use-language';
import { useSetting } from '../../lib/use-setting';
import { type Theme, useThemeStore } from '../../state/theme-store';

export const Route = createFileRoute('/settings/$section')({
  component: SectionView,
});

type SectionMeta = {
  titleKey: ParseKeys;
  /** Providers needs the full width; the rest read better at narrow column. */
  wide?: boolean;
  /**
   * Section fills the panel height and owns its own scroll (two-pane layouts).
   * Such sections don't get the outer content scroll — it would double up with
   * theirs and the page header would no longer stay pinned cleanly.
   */
  fill?: boolean;
  Component: () => React.JSX.Element;
};

const SECTIONS: Record<string, SectionMeta> = {
  general: { titleKey: 'settings.sections.generalTitle', Component: GeneralSection },
  identity: { titleKey: 'settings.sections.identityTitle', Component: IdentitySection },
  appearance: { titleKey: 'settings.sections.appearanceTitle', Component: AppearanceSection },
  memories: { titleKey: 'settings.sections.memoriesTitle', Component: MemoriesSection },
  pets: { titleKey: 'settings.sections.petsTitle', Component: PlaceholderSection },
  keyboard: { titleKey: 'settings.sections.keyboardTitle', Component: PlaceholderSection },
  usage: { titleKey: 'settings.sections.usageTitle', wide: true, Component: UsageSection },
  providers: {
    titleKey: 'settings.sections.providersTitle',
    wide: true,
    fill: true,
    Component: ProvidersSection,
  },
  skills: { titleKey: 'settings.sections.skillsTitle', Component: SkillsSection },
  subagents: {
    titleKey: 'settings.sections.subagentsTitle',
    wide: true,
    fill: true,
    Component: SubagentsSection,
  },
  mcp: { titleKey: 'settings.sections.mcpTitle', Component: PlaceholderSection },
  browser: { titleKey: 'settings.sections.browserTitle', Component: PlaceholderSection },
  computer: { titleKey: 'settings.sections.computerTitle', Component: PlaceholderSection },
  permissions: { titleKey: 'settings.sections.permissionsTitle', Component: PermissionsSection },
  hooks: { titleKey: 'settings.sections.hooksTitle', Component: PlaceholderSection },
  connections: { titleKey: 'settings.sections.connectionsTitle', Component: PlaceholderSection },
  git: { titleKey: 'settings.sections.gitTitle', Component: PlaceholderSection },
  environments: { titleKey: 'settings.sections.environmentsTitle', Component: PlaceholderSection },
  worktrees: { titleKey: 'settings.sections.worktreesTitle', Component: PlaceholderSection },
  archived: { titleKey: 'settings.sections.archivedTitle', Component: ArchivedSection },
  about: { titleKey: 'settings.sections.aboutTitle', Component: PlaceholderSection },
};

function SectionView(): React.JSX.Element {
  const { t } = useTranslation();
  const { section } = Route.useParams();
  const meta = SECTIONS[section];
  if (!meta) throw notFound();

  const { titleKey, wide = false, fill = false, Component } = meta;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Pinned header — only the content area below it scrolls. Every section
          shares the px-8 gutter so titles and content align panel-wide. */}
      <header className="shrink-0 px-8 pt-6 pb-5">
        <h1 className="font-semibold text-2xl text-fg-primary tracking-tight">{t(titleKey)}</h1>
      </header>
      {fill ? (
        <div className="min-h-0 flex-1 px-8 pb-6">
          <Component />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
          {/* Narrow sections cap line length for readability; wide flowing
              sections (usage) fill the panel. */}
          <div className={wide ? '' : 'w-full max-w-[760px]'}>
            <Component />
          </div>
        </div>
      )}
    </div>
  );
}

/** A titled card grouping related settings. Purely a visual cluster — storage
 *  stays flat, so the useSetting paths inside are unaffected. */
function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-fg-primary text-sm">{title}</h2>
      <div className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
        {children}
      </div>
    </section>
  );
}

/** One settings row inside a SettingGroup: label + optional description on the
 *  left, control on the right. */
function SettingRow({
  label,
  desc,
  control,
}: {
  label: string;
  desc?: string;
  control: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="min-w-0">
        <div className="font-medium text-fg-primary text-sm">{label}</div>
        {desc && <div className="mt-0.5 text-fg-tertiary text-xs">{desc}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function GeneralSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { pref, setLanguage } = useLanguage();
  const { value: autoTitle, set: setAutoTitle } = useSetting('general.autoGenerateTitle');
  const { value: inMenuBar, set: setInMenuBar } = useSetting('general.showInMenuBar');
  const utils = trpc.useUtils();
  const openAtLogin = trpc.settings.openAtLogin.useQuery();
  const setOpenAtLogin = trpc.settings.setOpenAtLogin.useMutation({
    onSuccess: () => utils.settings.openAtLogin.invalidate(),
  });
  const launchOn = openAtLogin.data ?? false;

  const languageOptions: ReadonlyArray<{ value: LanguagePref; label: string }> = [
    { value: 'system', label: t('settings.language.system') },
    { value: 'zh', label: t('settings.language.zh') },
    { value: 'en', label: t('settings.language.en') },
  ];

  return (
    <div className="flex flex-col gap-8">
      <SettingGroup title={t('settings.general.groupGeneral')}>
        <SettingRow
          label={t('settings.general.language')}
          desc={t('settings.general.languageDesc')}
          control={
            <Select
              value={pref}
              onChange={setLanguage}
              options={languageOptions}
              aria-label={t('settings.general.language')}
            />
          }
        />
        <SettingRow
          label={t('settings.general.autoTitle')}
          desc={t('settings.general.autoTitleDesc')}
          control={<EnableSwitch on={autoTitle} onToggle={() => setAutoTitle(!autoTitle)} />}
        />
        <SettingRow
          label={t('settings.general.launchAtLogin')}
          desc={t('settings.general.launchAtLoginDesc')}
          control={
            <EnableSwitch
              on={launchOn}
              onToggle={() => setOpenAtLogin.mutate({ enabled: !launchOn })}
            />
          }
        />
        <SettingRow
          label={t('settings.general.showInMenuBar')}
          desc={t('settings.general.showInMenuBarDesc')}
          control={<EnableSwitch on={inMenuBar} onToggle={() => setInMenuBar(!inMenuBar)} />}
        />
      </SettingGroup>
    </div>
  );
}

function AppearanceSection(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const tiles: Array<{ value: Theme; label: string; desc: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', desc: t('settings.appearance.lightDesc'), icon: Sun },
    { value: 'dark', label: 'Dark', desc: t('settings.appearance.darkDesc'), icon: Moon },
    { value: 'system', label: 'System', desc: t('settings.appearance.systemDesc'), icon: Monitor },
  ];

  return (
    <section>
      <h2 className="mb-3 font-medium text-fg-primary text-sm">{t('settings.appearance.theme')}</h2>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const isActive = theme === tile.value;
          return (
            <button
              type="button"
              key={tile.value}
              onClick={() => setTheme(tile.value)}
              className={`relative flex flex-col gap-2 rounded-lg border px-4 py-4 text-left transition-colors ${
                isActive
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-default bg-surface hover:border-border-strong'
              }`}
            >
              <div className="flex items-center justify-between">
                <Icon className={`size-[18px] ${isActive ? 'text-accent' : 'text-fg-secondary'}`} />
                {isActive && <Check className="size-[14px] text-accent" />}
              </div>
              <div>
                <div className="font-medium text-fg-primary text-sm">{tile.label}</div>
                <div className="text-fg-tertiary text-xs">{tile.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-fg-tertiary text-xs">{t('settings.appearance.note')}</p>
    </section>
  );
}

function PlaceholderSection(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-12 text-center">
      <p className="text-fg-tertiary text-sm">{t('settings.placeholder')}</p>
    </div>
  );
}
