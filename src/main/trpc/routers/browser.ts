import { isChromeInstalled } from '../../browser/detect';
import { publicProcedure, router } from '../trpc';

export const browserRouter = router({
  /** Environment probe for the Browser settings section: whether the browser the
   *  feature drives (Chrome) is installed, so the UI can gate the toggle and show
   *  the install prompt when it's missing. */
  environment: publicProcedure.query(() => ({ chromeInstalled: isChromeInstalled() })),
});
