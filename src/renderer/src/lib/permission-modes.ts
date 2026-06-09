import type { PermissionMode } from '@shared/permissions';
import { Bot, Shield, ShieldOff } from 'lucide-react';

export type PermissionModeMeta = {
  id: PermissionMode;
  label: string;
  desc: string;
  icon: typeof Shield;
  /** auto-review waits on the local-model reviewer — shown but not selectable yet. */
  disabled?: boolean;
};

/** The three permission modes, shared by the composer picker and Settings. */
export const PERMISSION_MODE_META: PermissionModeMeta[] = [
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
