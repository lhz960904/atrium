import { PRIVACY_PANES } from '@shared/computer-use';
import { app, shell, systemPreferences } from 'electron';
import { z } from 'zod';
import { hideDragOverlay, showDragOverlay } from '../../computer-use/drag-overlay';
import { publicProcedure, router } from '../trpc';

// Deep links into the exact privacy list for each grant, so the drag-to-grant
// flow lands the user on the right pane with one click.
const PRIVACY_PANE_URL: Record<(typeof PRIVACY_PANES)[number], string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

export const computerRouter = router({
  /**
   * macOS permission status for Computer Use. Under plan B the helper is
   * spawned by Atrium and borrows the main app's TCC grant, so the app's own
   * status is the source of truth. `isTrustedAccessibilityClient(false)` reads
   * the state without showing a prompt; screen capture is granted-or-not.
   */
  permissions: publicProcedure.query(() => {
    if (process.platform !== 'darwin') {
      return { supported: false, accessibility: false, screenRecording: false };
    }
    return {
      supported: true,
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted',
    };
  }),

  /** Opens the System Settings privacy pane for a grant (drag target for the drag-to-grant flow). */
  openPrivacyPane: publicProcedure.input(z.enum(PRIVACY_PANES)).mutation(({ input }) => {
    void shell.openExternal(PRIVACY_PANE_URL[input]);
  }),

  /**
   * Relaunches Atrium. macOS only reflects a screen-recording grant/revoke after
   * the app restarts, so the drag-to-grant flow calls this once both grants land.
   */
  relaunch: publicProcedure.mutation(() => {
    app.relaunch();
    app.exit(0);
  }),

  /** Shows the always-on-top drag source that floats over System Settings. */
  showDragOverlay: publicProcedure
    .input(
      z.object({
        title: z.string(),
        desc: z.string(),
        name: z.string(),
        hint: z.string(),
        dropHead: z.string(),
        dropHint: z.string(),
        closeLabel: z.string(),
      }),
    )
    .mutation(({ input }) => {
      void showDragOverlay(input);
    }),

  hideDragOverlay: publicProcedure.mutation(() => {
    hideDragOverlay();
  }),
});
