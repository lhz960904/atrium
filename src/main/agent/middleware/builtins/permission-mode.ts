import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@shared/permissions';
import { injectSystemReminder } from '../shared/reminder';
import type { AgentMiddleware, RunContext } from '../types';

export type PermissionModeOptions = { mode?: PermissionMode };

/**
 * The gate ENFORCES the permission mode; this note only CALIBRATES how much the
 * model asks vs. just acts — the gate can't stop it from prompting the user
 * redundantly or attempting writes that will be blocked. It rides as a
 * first-message reminder (not the static system prompt) because the mode is
 * volatile: the user toggles it per task.
 */
const MODE_NOTES: Record<PermissionMode, string> = {
  default:
    "You're in default mode. Actions inside the workspace run on their own; anything that reaches outside it or looks risky pauses for the user to approve. Don't ask for permission in prose — take the action and let the approval prompt handle it; save ask_clarification for genuine decisions only the user can make.",
  'auto-review':
    "You're in auto-review mode. Risky or out-of-workspace actions are vetted by an automatic reviewer instead of interrupting the user, so proceed confidently and don't ask for permission in prose; save ask_clarification for genuine decisions only the user can make.",
  'full-access':
    "You're in full-access mode. Every action runs immediately with no approval step — so take extra care with destructive or irreversible operations, since nothing will catch them for you.",
};

export function permissionModeMiddleware(opts: PermissionModeOptions = {}): AgentMiddleware {
  const mode = opts.mode ?? DEFAULT_PERMISSION_MODE;
  return {
    name: 'permission-mode',
    beforeRun(ctx: RunContext): void {
      ctx.request.messages = injectSystemReminder(
        ctx.request.messages,
        `<permission-mode>\n${MODE_NOTES[mode]}\n</permission-mode>`,
      );
    },
  };
}
