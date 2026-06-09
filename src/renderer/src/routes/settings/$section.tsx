import { createFileRoute, notFound } from '@tanstack/react-router';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { PermissionsSection } from '../../components/settings/permissions/PermissionsSection';
import { ProvidersSection } from '../../components/settings/providers/ProvidersSection';
import { SkillsSection } from '../../components/settings/skills/SkillsSection';
import { SubagentsSection } from '../../components/settings/subagents/SubagentsSection';
import { type Theme, useThemeStore } from '../../state/theme-store';

export const Route = createFileRoute('/settings/$section')({
  component: SectionView,
});

type SectionMeta = {
  title: string;
  sub: string;
  /** Providers needs the full width; the rest read better at narrow column. */
  wide?: boolean;
  Component: () => React.JSX.Element;
};

const SECTIONS: Record<string, SectionMeta> = {
  general: { title: 'General', sub: '对话风格、默认值、行为开关。', Component: PlaceholderSection },
  appearance: { title: 'Appearance', sub: '主题与外观偏好。', Component: AppearanceSection },
  providers: {
    title: 'Providers',
    sub: '配置 Atrium 如何接入语言模型。',
    wide: true,
    Component: ProvidersSection,
  },
  skills: {
    title: 'Skills',
    sub: '从 Agents、Claude、Codex 收集的技能，为 AI 赋予完成特定任务的专业能力。',
    Component: SkillsSection,
  },
  subagents: {
    title: 'Subagents',
    sub: 'task 工具拉起的子 agent：内置只读，自定义可配 prompt、工具与承接模型。',
    wide: true,
    Component: SubagentsSection,
  },
  permissions: {
    title: 'Permissions',
    sub: '工具调用的权限模式与信任清单。',
    Component: PermissionsSection,
  },
  memories: {
    title: 'Memories',
    sub: 'Atrium 记住的事实与上下文。',
    Component: PlaceholderSection,
  },
  about: { title: 'About', sub: '关于 Atrium。', Component: PlaceholderSection },
};

function SectionView(): React.JSX.Element {
  const { section } = Route.useParams();
  const meta = SECTIONS[section];
  if (!meta) throw notFound();

  const { title, sub, wide = false, Component } = meta;

  return (
    <div
      className={`flex h-full flex-col ${wide ? 'px-8 py-6' : 'mx-auto max-w-[720px] px-10 py-8'}`}
    >
      <h1 className="mb-1 font-semibold text-2xl text-fg-primary tracking-tight">{title}</h1>
      <p className={`text-fg-tertiary text-sm ${wide ? 'mb-5' : 'mb-8'}`}>{sub}</p>
      <div className={wide ? 'min-h-0 flex-1' : ''}>
        <Component />
      </div>
    </div>
  );
}

function AppearanceSection(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const tiles: Array<{ value: Theme; label: string; desc: string; icon: typeof Sun }> = [
    { value: 'light', label: 'Light', desc: 'Salon 主题', icon: Sun },
    { value: 'dark', label: 'Dark', desc: 'Studio 主题', icon: Moon },
    { value: 'system', label: 'System', desc: '跟随系统外观', icon: Monitor },
  ];

  return (
    <section>
      <h2 className="mb-3 font-medium text-fg-primary text-sm">Theme</h2>
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
      <p className="mt-4 text-fg-tertiary text-xs">
        切换会立即生效。System 模式会跟随 macOS 外观偏好自动变换。
      </p>
    </section>
  );
}

function PlaceholderSection(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border-default border-dashed bg-surface px-6 py-12 text-center">
      <p className="text-fg-tertiary text-sm">本节内容在后续步骤实装。</p>
    </div>
  );
}
