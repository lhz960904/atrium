import { createFileRoute, notFound } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArchivedSection } from '../../components/settings/archived/ArchivedSection';
import { IdentitySection } from '../../components/settings/identity/IdentitySection';
import { MemoriesSection } from '../../components/settings/memories/MemoriesSection';
import { PermissionsSection } from '../../components/settings/permissions/PermissionsSection';
import { ProvidersSection } from '../../components/settings/providers/ProvidersSection';
import { SkillsSection } from '../../components/settings/skills/SkillsSection';
import { SubagentsSection } from '../../components/settings/subagents/SubagentsSection';
import { type LanguagePref, useLanguage } from '../../lib/use-language';
import { type Theme, useThemeStore } from '../../state/theme-store';

export const Route = createFileRoute('/settings/$section')({
  component: SectionView,
});

type SectionMeta = {
  titleKey: ParseKeys;
  subKey: ParseKeys;
  /** Providers needs the full width; the rest read better at narrow column. */
  wide?: boolean;
  Component: () => React.JSX.Element;
};

const SECTIONS: Record<string, SectionMeta> = {
  general: {
    titleKey: 'settings.sections.generalTitle',
    subKey: 'settings.sections.generalSub',
    Component: GeneralSection,
  },
  appearance: {
    titleKey: 'settings.sections.appearanceTitle',
    subKey: 'settings.sections.appearanceSub',
    Component: AppearanceSection,
  },
  providers: {
    titleKey: 'settings.sections.providersTitle',
    subKey: 'settings.sections.providersSub',
    wide: true,
    Component: ProvidersSection,
  },
  skills: {
    titleKey: 'settings.sections.skillsTitle',
    subKey: 'settings.sections.skillsSub',
    Component: SkillsSection,
  },
  subagents: {
    titleKey: 'settings.sections.subagentsTitle',
    subKey: 'settings.sections.subagentsSub',
    wide: true,
    Component: SubagentsSection,
  },
  permissions: {
    titleKey: 'settings.sections.permissionsTitle',
    subKey: 'settings.sections.permissionsSub',
    Component: PermissionsSection,
  },
  identity: {
    titleKey: 'settings.sections.identityTitle',
    subKey: 'settings.sections.identitySub',
    Component: IdentitySection,
  },
  memories: {
    titleKey: 'settings.sections.memoriesTitle',
    subKey: 'settings.sections.memoriesSub',
    Component: MemoriesSection,
  },
  archived: {
    titleKey: 'settings.sections.archivedTitle',
    subKey: 'settings.sections.archivedSub',
    Component: ArchivedSection,
  },
  about: {
    titleKey: 'settings.sections.aboutTitle',
    subKey: 'settings.sections.aboutSub',
    Component: PlaceholderSection,
  },
};

function SectionView(): React.JSX.Element {
  const { t } = useTranslation();
  const { section } = Route.useParams();
  const meta = SECTIONS[section];
  if (!meta) throw notFound();

  const { titleKey, subKey, wide = false, Component } = meta;

  return (
    <div
      className={`flex h-full flex-col ${wide ? 'px-8 py-6' : 'mx-auto max-w-[720px] px-10 py-8'}`}
    >
      <h1 className="mb-1 font-semibold text-2xl text-fg-primary tracking-tight">{t(titleKey)}</h1>
      <p className={`text-fg-tertiary text-sm ${wide ? 'mb-5' : 'mb-8'}`}>{t(subKey)}</p>
      <div className={wide ? 'min-h-0 flex-1' : ''}>
        <Component />
      </div>
    </div>
  );
}

function GeneralSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { pref, setLanguage } = useLanguage();

  const tiles: Array<{ value: LanguagePref; label: string; desc?: string }> = [
    { value: 'zh', label: t('settings.language.zh') },
    { value: 'en', label: t('settings.language.en') },
    {
      value: 'system',
      label: t('settings.language.system'),
      desc: t('settings.language.systemDesc'),
    },
  ];

  return (
    <section>
      <h2 className="mb-3 font-medium text-fg-primary text-sm">{t('settings.language.title')}</h2>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => {
          const active = pref === tile.value;
          return (
            <button
              type="button"
              key={tile.value}
              onClick={() => setLanguage(tile.value)}
              className={`relative flex min-h-[68px] flex-col gap-1.5 rounded-lg border px-4 py-3.5 text-left transition-colors ${
                active
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-default bg-surface hover:border-border-strong'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-medium text-sm ${active ? 'text-accent' : 'text-fg-primary'}`}
                >
                  {tile.label}
                </span>
                {active && <Check className="size-[14px] text-accent" />}
              </div>
              {tile.desc && <span className="text-fg-tertiary text-xs">{tile.desc}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-fg-tertiary text-xs">{t('settings.language.note')}</p>
    </section>
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
