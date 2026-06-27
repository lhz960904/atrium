import { app, Menu, type NativeImage, nativeImage, Tray } from 'electron';
import appIcon from '../../resources/icon.png?asset';
import { getSettings } from './settings/conf';

let tray: Tray | null = null;

type MenuBarDeps = {
  /** Show (recreating if needed) and focus the main window. */
  showWindow: () => void;
  /** Show the window and tell the renderer to open a new chat (home). */
  newChat: () => void;
};

/** Derive a white menu-bar template from the colour app icon: treat the tile as
 *  the solid shape and knock the light "A" (+ pink bar, dot) out, so macOS tints
 *  it to match the bar (white on a dark one), consistent with the other icons.
 *  Rendered at 2× so it stays crisp on retina. */
function trayIcon(): NativeImage {
  const size = 44; // 22pt @2x
  const scaled = nativeImage
    .createFromPath(appIcon)
    .resize({ width: size, height: size, quality: 'best' });
  const bmp = scaled.toBitmap(); // BGRA
  const out = Buffer.alloc(bmp.length); // RGB stays 0 (black); alpha is the mask
  for (let i = 0; i < bmp.length; i += 4) {
    const light = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
    // Mid-tone purple tile → solid; bright foreground (A / bar / dot) → knockout.
    out[i + 3] = bmp[i + 3] > 40 && light <= 185 ? 255 : 0;
  }
  const img = nativeImage.createFromBitmap(out, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

function buildTray(deps: MenuBarDeps): Tray {
  const t = new Tray(trayIcon());
  t.setToolTip('Atrium');
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'New Chat', click: deps.newChat },
      { label: 'Open Atrium', click: deps.showWindow },
      { type: 'separator' },
      // app.quit() trips before-quit, which sets isQuitting so the window's
      // hide-on-close interception steps aside and the app really exits.
      { label: 'Quit Atrium', click: () => app.quit() },
    ]),
  );
  return t;
}

function apply(enabled: boolean, deps: MenuBarDeps): void {
  if (enabled && !tray) {
    tray = buildTray(deps);
  } else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

/** Mirror the menu-bar tray to the persisted setting — now, and on every toggle
 *  (electron-conf fires onDidChange when the renderer patches the scope). */
export function setupMenuBar(deps: MenuBarDeps): void {
  apply(getSettings('general.showInMenuBar'), deps);
  getSettings().onDidChange('general', (next) => {
    apply(Boolean(next?.showInMenuBar), deps);
  });
}
