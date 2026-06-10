import type { PermissionMode } from '@shared/permissions';
import type { ParseKeys } from 'i18next';
import { Bot, Shield, ShieldOff } from 'lucide-react';

export type PermissionModeMeta = {
  id: PermissionMode;
  labelKey: ParseKeys;
  descKey: ParseKeys;
  icon: typeof Shield;
  /** auto-review waits on the local-model reviewer — shown but not selectable yet. */
  disabled?: boolean;
};

/** The three permission modes, shared by the composer picker and Settings. */
export const PERMISSION_MODE_META: PermissionModeMeta[] = [
  {
    id: 'default',
    labelKey: 'settings.permissions.modeDefaultLabel',
    descKey: 'settings.permissions.modeDefaultDesc',
    icon: Shield,
  },
  {
    id: 'auto-review',
    labelKey: 'settings.permissions.modeReviewLabel',
    descKey: 'settings.permissions.modeReviewDesc',
    icon: Bot,
    disabled: true,
  },
  {
    id: 'full-access',
    labelKey: 'settings.permissions.modeFullLabel',
    descKey: 'settings.permissions.modeFullDesc',
    icon: ShieldOff,
  },
];
