import { PRIVACY_PANES } from '@shared/computer-use';
import { app, shell } from 'electron';
import { z } from 'zod';
import { disposeComputerUseHelper } from '../../computer-use';
import { hideDragOverlay, showDragOverlay } from '../../computer-use/drag-overlay';
import { computerPermissions } from '../../computer-use/permissions';
import { publicProcedure, router } from '../trpc';

// Deep links into the exact privacy list for each grant, so the drag-to-grant
// flow lands the user on the right pane with one click.
const PRIVACY_PANE_URL: Record<(typeof PRIVACY_PANES)[number], string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

export const computerRouter = router({
  /** macOS TCC status for Computer Use (see computerPermissions). */
  permissions: publicProcedure.query(() => computerPermissions()),

  /** Opens the System Settings privacy pane for a grant (drag target for the drag-to-grant flow). */
  openPrivacyPane: publicProcedure.input(z.enum(PRIVACY_PANES)).mutation(({ input }) => {
    void shell.openExternal(PRIVACY_PANE_URL[input]);
  }),

  /**
   * Relaunches Atrium. macOS only reflects a screen-recording grant/revoke after
   * the app restarts, so the drag-to-grant flow calls this once both grants land.
   */
  relaunch: publicProcedure.mutation(() => {
    // app.exit skips before-quit, so kill the helper here — the grant flow's
    // overlay was polling it moments ago, and an orphaned child would keep
    // its cursor overlay on screen across the relaunch.
    disposeComputerUseHelper();
    app.relaunch();
    app.exit(0);
  }),

  /** Shows the always-on-top drag source that floats over System Settings. */
  showDragOverlay: publicProcedure
    .input(
      z.object({
        heading: z.string(),
        name: z.string(),
        dragLabel: z.string(),
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
