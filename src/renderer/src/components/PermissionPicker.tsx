import * as Popover from '@radix-ui/react-popover';
import type { PermissionMode } from '@shared/permissions';
import { Bot, Check, ChevronDown, Shield, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { usePermissionStore } from '../state/permission-store';

type ModeMeta = {
  id: PermissionMode;
  label: string;
  desc: string;
  icon: typeof Shield;
  disabled?: boolean;
};

const MODES: ModeMeta[] = [
  {
    id: 'default',
    label: '默认权限',
    desc: '越界操作（联网 / 外部写 / 危险命令）需你确认',
    icon: Shield,
  },
  {
    id: 'auto-review',
    label: '自动审查',
    desc: '越界交 AI 审查（需本地模型，暂未启用）',
    icon: Bot,
    disabled: true,
  },
  { id: 'full-access', label: '完全放行', desc: '不拦截任何操作', icon: ShieldOff },
];

/**
 * Composer-footer selector for the tool-permission mode (mirrors ModelPicker).
 * full-access tints the trigger as a warning — protection is off. auto-review
 * waits on the local-model reviewer, so it's shown but disabled.
 */
export function PermissionPicker(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const mode = usePermissionStore((s) => s.mode);
  const setMode = usePermissionStore((s) => s.setMode);
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const Icon = current.icon;
  const danger = current.id === 'full-access';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-elevated ${danger ? 'text-warning hover:text-warning' : 'text-fg-tertiary hover:text-fg-secondary'}`}
        >
          <Icon className="size-[14px] shrink-0" />
          <span>{current.label}</span>
          <ChevronDown className="size-[14px] shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-72 overflow-hidden rounded-lg border border-border-default bg-elevated p-1 shadow-lg"
        >
          {MODES.map((m) => {
            const MIcon = m.icon;
            const sel = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => {
                  setMode(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50 ${sel ? 'text-fg-primary' : 'text-fg-secondary'}`}
              >
                <MIcon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm">
                    {m.label}
                    {sel && <Check className="size-[13px] shrink-0 text-accent" />}
                  </span>
                  <span className="mt-0.5 block text-fg-tertiary text-xs leading-snug">
                    {m.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
