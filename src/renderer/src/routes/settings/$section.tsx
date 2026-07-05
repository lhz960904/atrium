import {
  CODE_THEMES_DARK,
  CODE_THEMES_LIGHT,
  type CodeThemeDark,
  type CodeThemeLight,
  type ComposerSendKey,
  type UiFontSize,
} from '@shared/settings';
import type { UpdaterStage } from '@shared/update';
import { createFileRoute, notFound } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import { ArrowUpRight, Check, MessageSquare, Monitor, Moon, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { getTokenStyleObject } from 'shiki';
import { ModelPicker } from '../../components/ModelPicker';
import { Select } from '../../components/Select';
import { ArchivedSection } from '../../components/settings/archived/ArchivedSection';
import { IdentitySection } from '../../components/settings/identity/IdentitySection';
import { KeyboardSection } from '../../components/settings/keyboard/KeyboardSection';
import { McpSection } from '../../components/settings/mcp/McpSection';
import { MemoriesSection } from '../../components/settings/memories/MemoriesSection';
import { PermissionsSection } from '../../components/settings/permissions/PermissionsSection';
import { EnableSwitch } from '../../components/settings/providers/EnableSwitch';
import { ProvidersSection } from '../../components/settings/providers/ProvidersSection';
import { SkillsSection } from '../../components/settings/skills/SkillsSection';
import { SubagentsSection } from '../../components/settings/subagents/SubagentsSection';
import { UsageSection } from '../../components/settings/usage/UsageSection';
import { highlighter } from '../../lib/code-highlighter';
import { trpc } from '../../lib/trpc';
import { deriveGroups } from '../../lib/use-chat-model';
import { type LanguagePref, useLanguage } from '../../lib/use-language';
import { useSetting } from '../../lib/use-setting';
import { type Theme, useThemeStore } from '../../state/theme-store';
import { useUpdateStore } from '../../state/update-store';

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
  keyboard: { titleKey: 'settings.sections.keyboardTitle', Component: KeyboardSection },
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
  mcp: { titleKey: 'settings.sections.mcpTitle', wide: true, fill: true, Component: McpSection },
  browser: { titleKey: 'settings.sections.browserTitle', Component: PlaceholderSection },
  computer: { titleKey: 'settings.sections.computerTitle', Component: PlaceholderSection },
  permissions: { titleKey: 'settings.sections.permissionsTitle', Component: PermissionsSection },
  hooks: { titleKey: 'settings.sections.hooksTitle', Component: PlaceholderSection },
  connections: { titleKey: 'settings.sections.connectionsTitle', Component: PlaceholderSection },
  worktrees: { titleKey: 'settings.sections.worktreesTitle', Component: PlaceholderSection },
  archived: { titleKey: 'settings.sections.archivedTitle', Component: ArchivedSection },
  about: { titleKey: 'settings.sections.aboutTitle', Component: AboutSection },
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

// ⌘ on Apple keyboards, Ctrl everywhere else — only affects the option label;
// the composer itself accepts either modifier (see isSendCombo).
const MOD_LABEL = navigator.userAgent.includes('Macintosh') ? '⌘' : 'Ctrl';

function GeneralSection(): React.JSX.Element {
  const { t } = useTranslation();
  const { pref, setLanguage } = useLanguage();
  const { value: autoTitle, set: setAutoTitle } = useSetting('general.autoGenerateTitle');
  const { value: inMenuBar, set: setInMenuBar } = useSetting('general.showInMenuBar');
  const { value: hideTokens, set: setHideTokens } = useSetting('general.composerHideTokenUsage');
  const { value: sendKey, set: setSendKey } = useSetting('general.composerSendKey');
  const { value: defaultModel, set: setDefaultModel } = useSetting('general.defaultModel');
  const providers = trpc.providers.list.useQuery();
  const modelGroups = deriveGroups(providers.data ?? []);
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

  const sendKeyOptions: ReadonlyArray<{ value: ComposerSendKey; label: string }> = [
    { value: 'enter', label: t('settings.general.sendKeyEnter') },
    { value: 'mod', label: t('settings.general.sendKeyMod', { mod: MOD_LABEL }) },
    { value: 'shift', label: t('settings.general.sendKeyShift') },
  ];

  return (
    <div className="flex flex-col gap-8">
      <SettingGroup title={t('settings.general.groupGeneral')}>
        <SettingRow
          label={t('settings.general.defaultModel')}
          desc={t('settings.general.defaultModelDesc')}
          control={
            <ModelPicker
              value={defaultModel}
              onChange={(v) => v && setDefaultModel(v)}
              groups={modelGroups}
              variant="field"
              placeholder={t('settings.general.defaultModelAuto')}
            />
          }
        />
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

      <SettingGroup title={t('settings.general.groupComposer')}>
        <SettingRow
          label={t('settings.general.sendKey')}
          desc={t('settings.general.sendKeyDesc')}
          control={
            <Select
              value={sendKey}
              onChange={setSendKey}
              options={sendKeyOptions}
              aria-label={t('settings.general.sendKey')}
            />
          }
        />
        <SettingRow
          label={t('settings.general.hideTokenUsage')}
          desc={t('settings.general.hideTokenUsageDesc')}
          control={<EnableSwitch on={hideTokens} onToggle={() => setHideTokens(!hideTokens)} />}
        />
      </SettingGroup>
    </div>
  );
}

/** Shiki theme id → display label, e.g. `one-dark-pro` → `One Dark Pro`. */
const prettyTheme = (id: string): string =>
  id.replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase()).trim();

const LIGHT_THEME_OPTIONS: ReadonlyArray<{ value: CodeThemeLight; label: string }> =
  CODE_THEMES_LIGHT.map((v) => ({ value: v, label: prettyTheme(v) }));
const DARK_THEME_OPTIONS: ReadonlyArray<{ value: CodeThemeDark; label: string }> =
  CODE_THEMES_DARK.map((v) => ({ value: v, label: prettyTheme(v) }));

const PREVIEW_CODE = `interface Config {
  name: string; // workspace label
  accent: string;
}
const theme: Config = { name: "atrium", accent: "#2383E2" };
export const enabled = true;`;

/** Renders the fixed snippet in a specific Shiki theme, using that theme's own
 *  background/foreground — so a code theme can be judged before it's applied. */
function ThemePreview({ theme }: { theme: string }): React.JSX.Element {
  const { tokens, bg, fg } = useMemo(
    () => highlighter.codeToTokens(PREVIEW_CODE, { lang: 'typescript', theme }),
    [theme],
  );
  return (
    <div
      className="overflow-hidden rounded-lg border border-border-default text-xs leading-relaxed"
      style={{ background: bg, color: fg }}
    >
      <pre className="overflow-x-auto p-3 font-mono">
        {tokens.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: preview lines have no stable id
          <div key={i} className="flex">
            <span className="mr-3 w-4 shrink-0 select-none text-right tabular-nums opacity-40">
              {i + 1}
            </span>
            <span className="whitespace-pre">
              {line.map((tk, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: preview tokens have no stable id
                <span key={k} style={getTokenStyleObject(tk)}>
                  {tk.content}
                </span>
              ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function AppearanceSection(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { value: uiFont, set: setUiFont } = useSetting('appearance.uiFont');
  const { value: uiFontSize, set: setUiFontSize } = useSetting('appearance.uiFontSize');
  const { value: codeThemeLight, set: setCodeThemeLight } = useSetting('appearance.codeThemeLight');
  const { value: codeThemeDark, set: setCodeThemeDark } = useSetting('appearance.codeThemeDark');

  const tiles: Array<{ value: Theme; label: string; desc: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', desc: t('settings.appearance.lightDesc'), icon: Sun },
    { value: 'dark', label: 'Dark', desc: t('settings.appearance.darkDesc'), icon: Moon },
    { value: 'system', label: 'System', desc: t('settings.appearance.systemDesc'), icon: Monitor },
  ];

  const fontSizeOptions: ReadonlyArray<{ value: UiFontSize; label: string }> = [
    { value: 'small', label: t('settings.appearance.fontSizeSmall') },
    { value: 'default', label: t('settings.appearance.fontSizeDefault') },
    { value: 'large', label: t('settings.appearance.fontSizeLarge') },
  ];

  const inputClass =
    'rounded-md border border-border-default bg-elevated px-2.5 py-1.5 text-fg-primary text-sm focus:border-border-focus focus:outline-none';

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-medium text-fg-primary text-sm">
          {t('settings.appearance.theme')}
        </h2>
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
                  <Icon
                    className={`size-[18px] ${isActive ? 'text-accent' : 'text-fg-secondary'}`}
                  />
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

      <SettingGroup title={t('settings.appearance.textGroup')}>
        <SettingRow
          label={t('settings.appearance.uiFont')}
          desc={t('settings.appearance.uiFontDesc')}
          control={
            <input
              type="text"
              value={uiFont}
              onChange={(e) => setUiFont(e.target.value)}
              placeholder={t('settings.appearance.uiFontPlaceholder')}
              aria-label={t('settings.appearance.uiFont')}
              className={`w-56 placeholder:text-fg-tertiary ${inputClass}`}
            />
          }
        />
        <SettingRow
          label={t('settings.appearance.fontSize')}
          desc={t('settings.appearance.fontSizeDesc')}
          control={
            <Select
              value={uiFontSize}
              onChange={setUiFontSize}
              options={fontSizeOptions}
              aria-label={t('settings.appearance.fontSize')}
            />
          }
        />
      </SettingGroup>

      <section>
        <h2 className="mb-3 font-medium text-fg-primary text-sm">
          {t('settings.appearance.codeGroup')}
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="font-medium text-fg-secondary text-xs">
              {t('settings.appearance.codeThemeLight')}
            </span>
            <Select
              value={codeThemeLight}
              onChange={setCodeThemeLight}
              options={LIGHT_THEME_OPTIONS}
              aria-label={t('settings.appearance.codeThemeLight')}
              className="w-full"
            />
            <ThemePreview theme={codeThemeLight} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="font-medium text-fg-secondary text-xs">
              {t('settings.appearance.codeThemeDark')}
            </span>
            <Select
              value={codeThemeDark}
              onChange={setCodeThemeDark}
              options={DARK_THEME_OPTIONS}
              aria-label={t('settings.appearance.codeThemeDark')}
              className="w-full"
            />
            <ThemePreview theme={codeThemeDark} />
          </div>
        </div>
      </section>
    </div>
  );
}

const AUTHOR_URL = 'https://github.com/lhz960904';
const ISSUES_URL = 'https://github.com/lhz960904/atrium/issues/new';

/** Semantic colour for the update-status dot. */
const STATUS_DOT: Record<UpdaterStage, string> = {
  idle: 'bg-success',
  checking: 'bg-accent-alt',
  available: 'bg-accent',
  downloading: 'bg-accent',
  downloaded: 'bg-accent',
  error: 'bg-danger',
};

/** Locale-aware "3 minutes ago" for the last-checked line; `never` when unset. */
function formatChecked(ts: number | null, lang: string, never: string): string {
  if (!ts) return never;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const sec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, 'second');
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86_400), 'day');
}

function AboutSection(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const state = useUpdateStore((s) => s.state);
  const openDialog = useUpdateStore((s) => s.openDialog);
  const check = trpc.update.check.useMutation();

  const hasUpdate =
    state.stage === 'available' || state.stage === 'downloading' || state.stage === 'downloaded';
  const checking = state.stage === 'checking';

  const status = ((): string => {
    switch (state.stage) {
      case 'checking':
        return t('settings.about.checking');
      case 'available':
        return t('settings.about.available', { version: state.info?.version ?? '' });
      case 'downloading':
        return t('settings.about.downloadingStatus', {
          percent: Math.round(state.progress?.percent ?? 0),
        });
      case 'downloaded':
        return t('settings.about.readyStatus', { version: state.info?.version ?? '' });
      case 'error':
        return t('settings.about.checkFailed');
      default:
        return t('settings.about.upToDate');
    }
  })();

  const lastChecked = formatChecked(state.lastCheckedAt, i18n.language, t('settings.about.never'));

  const updateBtn =
    'shrink-0 rounded-lg bg-accent px-3.5 py-2 font-medium text-fg-on-accent text-sm shadow-xs hover:bg-accent-hover disabled:opacity-60';

  return (
    <div className="flex flex-col gap-4">
      {/* Product panel: identity up top, a divided update band below. */}
      <div className="overflow-hidden rounded-2xl border border-border-default bg-surface shadow-xs">
        <div className="px-7 pt-7 pb-6">
          <div className="flex items-center gap-2.5">
            <h1 className="font-semibold text-fg-primary text-lg tracking-tight">Atrium</h1>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent text-xs tabular-nums">
              {state.currentVersion}
            </span>
          </div>
          <p className="mt-2 text-fg-secondary text-sm leading-relaxed">
            {t('settings.about.description')}
          </p>
          <p className="mt-2 text-fg-tertiary text-xs">
            <Trans
              i18nKey="settings.about.craftedBy"
              components={{
                author: (
                  // biome-ignore lint/a11y/useAnchorContent: Trans injects the link text
                  <a
                    href={AUTHOR_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-accent hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 border-border-default border-t px-7 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_DOT[state.stage]} ${checking ? 'animate-pulse' : ''}`}
            />
            <div className="min-w-0">
              <div className="text-fg-primary text-sm">{status}</div>
              <div className="mt-0.5 text-fg-tertiary text-xs">
                {t('settings.about.lastChecked')} · {lastChecked}
              </div>
            </div>
          </div>
          {hasUpdate ? (
            <button type="button" onClick={openDialog} className={updateBtn}>
              {t('update.entry')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => check.mutate()}
              disabled={checking}
              className={updateBtn}
            >
              {checking ? t('settings.about.checking') : t('settings.about.checkNow')}
            </button>
          )}
        </div>
      </div>

      {/* Feedback: the whole card opens GitHub issues. */}
      <a
        href={ISSUES_URL}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3.5 rounded-2xl border border-border-default bg-surface px-5 py-4 shadow-xs transition-colors hover:border-border-strong"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <MessageSquare className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg-primary text-sm">{t('settings.about.feedback')}</div>
          <div className="mt-0.5 text-fg-tertiary text-xs">{t('settings.about.feedbackDesc')}</div>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-fg-tertiary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg-secondary" />
      </a>
    </div>
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
