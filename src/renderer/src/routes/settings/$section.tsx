import { createFileRoute, notFound } from '@tanstack/react-router';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { type Theme, useThemeStore } from '../../state/theme-store';

export const Route = createFileRoute('/settings/$section')({
  component: SectionView,
});

type SectionMeta = {
  title: string;
  sub: string;
};

const SECTIONS: Record<string, SectionMeta> = {
  general: { title: 'General', sub: '对话风格、默认值、行为开关。' },
  appearance: { title: 'Appearance', sub: '主题与外观偏好。' },
  providers: { title: 'Providers', sub: '配置 Atrium 如何接入语言模型。' },
  subagents: { title: 'Subagents', sub: 'task 工具拉起的子 agent 的运行限制与可用工具。' },
  permissions: { title: 'Permissions', sub: '工具调用权限与通知。' },
  memories: { title: 'Memories', sub: 'Atrium 记住的事实与上下文。' },
  about: { title: 'About', sub: '关于 Atrium。' },
};

function SectionView(): React.JSX.Element {
  const { section } = Route.useParams();
  const meta = SECTIONS[section];
  if (!meta) throw notFound();

  return (
    <div className="mx-auto max-w-[720px] px-10 py-8">
      <h1 className="mb-1 font-semibold text-2xl text-fg-primary tracking-tight">{meta.title}</h1>
      <p className="mb-8 text-fg-tertiary text-sm">{meta.sub}</p>

      {section === 'appearance' ? <AppearanceSection /> : <PlaceholderSection />}
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
