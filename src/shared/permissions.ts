/** The tool-permission modes a user picks per thread. */
export const PERMISSION_MODES = ['default', 'auto-review', 'full-access'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';
