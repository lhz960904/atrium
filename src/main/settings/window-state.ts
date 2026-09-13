import type { BrowserWindow } from 'electron';
import { getSettings, type WindowState } from './conf';

/**
 * Returns the size + maximized state to use for the next
 * BrowserWindow creation. Position is intentionally not persisted — the
 * OS centres the window on its own, which side-steps "window restored to
 * an external monitor that's no longer plugged in" failure modes.
 */
export function getInitialWindowState(): WindowState {
  return getSettings('appearance.windowState');
}

/**
 * Compute the snapshot to persist. While the window is maximized or in
 * fullscreen, `getBounds()` reports the inflated size, so we keep the last
 * "normal" width/height already on disk rather than storing a screen-sized
 * window.
 *
 * Fullscreen is a mode the app never comes back into: on macOS closing has to
 * leave it before hiding (an emptied Space blacks out the screen), so it can
 * only ever be restored on some of the ways out. Leaving it always lands on
 * the plain window instead — by any route, including a quit that never
 * animated out of it.
 */
function snapshot(win: BrowserWindow): WindowState {
  const previous = getSettings('appearance.windowState');
  // Neither call describes the window behind a fullscreen frame — isMaximized()
  // reports the frame itself, whose macOS answer isn't worth relying on.
  if (win.isFullScreen()) {
    return { width: previous.width, height: previous.height, maximized: false };
  }
  if (win.isMaximized()) {
    return { width: previous.width, height: previous.height, maximized: true };
  }
  const { width, height } = win.getBounds();
  return { width, height, maximized: false };
}

/** Read-modify-write the appearance scope so a windowState write preserves any
 *  sibling appearance settings (e.g. a future theme). */
function persist(win: BrowserWindow): void {
  getSettings().set('appearance', { ...getSettings('appearance'), windowState: snapshot(win) });
}

/**
 * Hook the window's lifecycle so the next launch can restore size +
 * maximized state. Resize bursts are debounced so we don't hammer the
 * settings file while the user is dragging the corner.
 */
export function attachWindowStatePersistence(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persist(win), 200);
  };

  win.on('resize', save);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('enter-full-screen', save);
  win.on('leave-full-screen', save);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    // Flush a final write so the very last resize before close is captured.
    persist(win);
  });
}
