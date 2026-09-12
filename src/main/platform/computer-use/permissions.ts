import { COMPUTER_USE_NEEDS_PERMISSION_CHANNEL } from '@shared/computer-use';
import { systemPreferences, type WebContents } from 'electron';

export interface ComputerPermissions {
  supported: boolean;
  accessibility: boolean;
  screenRecording: boolean;
}

/**
 * TCC status for Computer Use. Under plan B the helper borrows Atrium's own
 * grant, so the app's status is the source of truth. `isTrustedAccessibilityClient(false)`
 * reads state without prompting; screen capture is granted-or-not.
 */
export function computerPermissions(): ComputerPermissions {
  if (process.platform !== 'darwin') {
    return { supported: false, accessibility: false, screenRecording: false };
  }
  return {
    supported: true,
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted',
  };
}

let getWebContents: (() => WebContents | undefined) | null = null;

/** Lets the agent loop (no window handle of its own) reach the main window. */
export function registerPermissionBridge(resolve: () => WebContents | undefined): void {
  getWebContents = resolve;
}

/** Ask the renderer to pop the drag-to-grant dialog for the missing grants. */
export function promptPermissionGrant(perms: ComputerPermissions): void {
  getWebContents?.()?.send(COMPUTER_USE_NEEDS_PERMISSION_CHANNEL, perms);
}
