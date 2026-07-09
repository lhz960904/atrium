import { dirname, resolve } from 'node:path';
import { COMPUTER_USE_DRAG_CHANNEL } from '@shared/computer-use';
import { app, ipcMain, type NativeImage, nativeImage } from 'electron';
import { createLogger } from '../log';

const log = createLogger('computer-use-drag');

/**
 * The .app bundle to drag into a privacy list. Under plan B the helper borrows
 * Atrium's own TCC grant, so the grant target — and thus the drag payload — is
 * Atrium itself, not the helper. The exe lives at
 * `<Bundle>.app/Contents/MacOS/<exe>`, so two levels up from its directory is the
 * bundle: Electron.app in dev, Atrium.app when packaged.
 */
function resolveSelfBundlePath(): string {
  return resolve(dirname(app.getPath('exe')), '..', '..');
}

function fallbackIcon(): NativeImage {
  return nativeImage.createFromNamedImage('NSApplicationIcon');
}

/**
 * Registers the native file-drag behind the drag-to-grant permission flow.
 * `startDrag` must run synchronously inside the drag-gesture IPC message —
 * Electron ties the OS drag to it — so this rides a bare `ipcMain.on` channel
 * instead of tRPC's async round-trip. The drag icon is preloaded because
 * `startDrag` needs it in hand; until it loads we fall back to the generic app
 * icon rather than block.
 */
export function registerComputerUseDrag(): void {
  if (process.platform !== 'darwin') return;

  const bundle = resolveSelfBundlePath();
  let icon: NativeImage = fallbackIcon();
  app
    .getFileIcon(bundle, { size: 'normal' })
    .then((loaded) => {
      if (!loaded.isEmpty()) icon = loaded;
    })
    .catch((err) => log.warn('getFileIcon failed, using fallback icon', err));

  ipcMain.on(COMPUTER_USE_DRAG_CHANNEL, (event) => {
    try {
      event.sender.startDrag({ file: bundle, icon });
    } catch (err) {
      log.error('startDrag failed', err);
    }
  });
}
