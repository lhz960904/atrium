import type { BrowserWindow } from 'electron';
import { DEFAULTS, getSettings, type WindowState } from './conf';

/**
 * Returns the size + maximized + fullscreen state to use for the next
 * BrowserWindow creation. Position is intentionally not persisted — the
 * OS centres the window on its own, which side-steps "window restored to
 * an external monitor that's no longer plugged in" failure modes.
 */
export function getInitialWindowState(): WindowState {
  return getSettings().get('windowState', DEFAULTS.windowState);
}

/**
 * Compute the snapshot to persist. While the window is maximized or in
 * fullscreen, `getBounds()` reports the inflated size; we keep the last
 * "normal" width/height already on disk so exiting either mode restores a
 * sensible window rather than a screen-sized one.
 */
function snapshot(win: BrowserWindow): WindowState {
  const conf = getSettings();
  const previous = conf.get('windowState', DEFAULTS.windowState);
  const maximized = win.isMaximized();
  const fullscreen = win.isFullScreen();
  if (maximized || fullscreen) {
    return { ...previous, maximized, fullscreen };
  }
  const { width, height } = win.getBounds();
  return { width, height, maximized: false, fullscreen: false };
}

/**
 * Hook the window's lifecycle so the next launch can restore size +
 * maximized + fullscreen state. Resize bursts are debounced so we don't
 * hammer the settings file while the user is dragging the corner.
 */
export function attachWindowStatePersistence(win: BrowserWindow): void {
  const conf = getSettings();
  let timer: NodeJS.Timeout | null = null;

  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      conf.set('windowState', snapshot(win));
    }, 200);
  };

  win.on('resize', save);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('enter-full-screen', save);
  win.on('leave-full-screen', save);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    // Flush a final write so the very last resize before close is captured.
    conf.set('windowState', snapshot(win));
  });
}
