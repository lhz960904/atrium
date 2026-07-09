import { systemPreferences } from 'electron';
import { publicProcedure, router } from '../trpc';

export const computerRouter = router({
  /**
   * macOS permission status for Computer Use. Under plan B the helper is
   * spawned by Atrium and borrows the main app's TCC grant, so the app's own
   * status is the source of truth. `isTrustedAccessibilityClient(false)` reads
   * the state without showing a prompt; screen capture is granted-or-not.
   */
  permissions: publicProcedure.query(() => {
    if (process.platform !== 'darwin') {
      return { accessibility: false, screenRecording: false };
    }
    return {
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted',
    };
  }),
});
