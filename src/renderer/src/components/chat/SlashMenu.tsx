import {
  Atom,
  AtSign,
  Box,
  Brain,
  Brush,
  Download,
  Eraser,
  GitBranch,
  Layers,
  ListChecks,
  type LucideIcon,
  Octagon,
  Palette,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect } from 'react';

export type SlashMenuItem = {
  name: string;
  desc: string;
  icon?: LucideIcon;
};

export const SLASH_COMMANDS: SlashMenuItem[] = [
  { name: 'Branch', desc: '从当前对话开一个新分支', icon: GitBranch },
  { name: 'Clear', desc: '清空当前对话', icon: Eraser },
  { name: 'Compact', desc: '压缩历史上下文', icon: Box },
  { name: 'Export', desc: '导出对话为 Markdown', icon: Download },
  { name: 'Memories', desc: '查看 / 管理 Atrium 记住的内容', icon: Brain },
  { name: 'Model', desc: '切换当前对话的模型', icon: Atom },
  { name: 'Permissions', desc: '调整工具权限', icon: SlidersHorizontal },
  { name: 'Plan mode', desc: '进入计划模式（只读 / 列计划）', icon: ListChecks },
  { name: 'Search', desc: '搜索过往对话 / 文件 / artifact', icon: Search },
  { name: 'Settings', desc: '打开设置面板', icon: SlidersHorizontal },
  { name: 'Stop', desc: '停止当前 agent 运行', icon: Octagon },
  { name: 'Theme', desc: '切换 light / dark / 跟随系统', icon: Palette },
];

export const MENTION_ITEMS: SlashMenuItem[] = [
  { name: 'D11 Provider 配置 IA 收敛', desc: 'chat · 2h ago', icon: AtSign },
  { name: 'D12 subagent card / settings', desc: 'chat · 1d ago', icon: AtSign },
  { name: 'tokens.css', desc: 'artifact · 3d ago', icon: Layers },
  { name: 'src/main/db/schema.ts', desc: 'file', icon: Brush },
];

export function SlashMenu({
  items,
  query,
  activeIndex,
  onHoverIndex,
  onSelect,
}: {
  items: SlashMenuItem[];
  /** Text after the trigger char (e.g. "co" filters items starting with "co"). */
  query: string;
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: SlashMenuItem) => void;
}): React.JSX.Element | null {
  const filtered = items.filter((item) =>
    query.length === 0 ? true : item.name.toLowerCase().startsWith(query.toLowerCase()),
  );

  // Keep active index in range
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onHoverIndex(Math.max(0, filtered.length - 1));
    }
  }, [activeIndex, filtered.length, onHoverIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-hidden rounded-lg border border-border-default bg-elevated shadow-md">
      <ul className="max-h-[280px] overflow-y-auto py-1">
        {filtered.map((item, i) => {
          const Icon = item.icon;
          const active = i === activeIndex;
          return (
            <li key={item.name}>
              <button
                type="button"
                onMouseEnter={() => onHoverIndex(i)}
                onMouseDown={(e) => {
                  // Prevent textarea blur before click handler fires
                  e.preventDefault();
                }}
                onClick={() => onSelect(item)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                  active ? 'bg-surface-strong text-fg-primary' : 'text-fg-secondary'
                }`}
              >
                {Icon && <Icon className="size-4 shrink-0 text-fg-tertiary" />}
                <span className="font-medium">{item.name}</span>
                <span className="truncate text-fg-tertiary text-xs">{item.desc}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
