import {
  UPDATE_STATE_CHANNEL,
  type UpdateAvailableInfo,
  type UpdateProgress,
  type UpdaterState,
} from '@shared/update';
import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { createLogger } from './log';

const log = createLogger('updater');

/**
 * Wraps electron-updater in a small state machine and broadcasts every
 * transition to the renderer over a single channel, so any window (including one
 * reopened after a hide/close) re-seeds from getState() and then follows live.
 *
 * v1 is deliberately click-to-download: autoDownload is off and nothing is
 * fetched until the renderer calls download(). Background download and periodic
 * polling are intentionally deferred until the update path is proven stable.
 */
class UpdaterManager {
  private state: UpdaterState = {
    stage: 'idle',
    currentVersion: app.getVersion(),
    info: null,
    progress: null,
    error: null,
  };
  private getWindow: () => BrowserWindow | null = () => null;
  private wired = false;

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
    if (this.wired) return;
    this.wired = true;

    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => this.set({ stage: 'checking', error: null }));
    autoUpdater.on('update-available', (info) =>
      this.set({ stage: 'available', info: toInfo(info), progress: null }),
    );
    autoUpdater.on('update-not-available', () =>
      this.set({ stage: 'idle', info: null, progress: null }),
    );
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.set({ stage: 'downloading', progress: toProgress(p) }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ stage: 'downloaded', info: toInfo(info), progress: null }),
    );
    autoUpdater.on('error', (err) =>
      this.set({ stage: 'error', error: err?.message ?? String(err) }),
    );
  }

  /** One-shot check. Silent no-op when unpacked unless FORCE_DEV_UPDATE_CONFIG. */
  async check(): Promise<void> {
    if (!this.canCheck()) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      log.warn('checkForUpdates failed:', err);
      this.set({ stage: 'error', error: errorMessage(err) });
    }
  }

  async download(): Promise<void> {
    if (this.state.stage === 'downloading') return;
    try {
      this.set({ stage: 'downloading', progress: null, error: null });
      await autoUpdater.downloadUpdate();
    } catch (err) {
      log.warn('downloadUpdate failed:', err);
      this.set({ stage: 'error', error: errorMessage(err) });
    }
  }

  /** Quit and swap in the downloaded update; only valid after 'downloaded'. */
  install(): void {
    if (this.state.stage !== 'downloaded') return;
    // isSilent=false so the OS installer UI can surface any prompt; isForceRunAfter
    // relaunches straight into the new version instead of leaving the app closed.
    autoUpdater.quitAndInstall(false, true);
  }

  getState(): UpdaterState {
    return this.state;
  }

  private canCheck(): boolean {
    if (app.isPackaged) return true;
    // Dev opt-in: reads dev-app-update.yml so the flow is exercisable while unpacked.
    if (process.env.FORCE_DEV_UPDATE_CONFIG) {
      autoUpdater.forceDevUpdateConfig = true;
      return true;
    }
    log.info('skip update check: app is not packaged');
    return false;
  }

  private set(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch };
    this.getWindow()?.webContents.send(UPDATE_STATE_CHANNEL, this.state);
  }
}

function toInfo(info: UpdateInfo): UpdateAvailableInfo {
  return {
    version: info.version,
    // The GitHub provider hands back the release body as a string; the array form
    // (per-file notes) isn't used here, so anything non-string collapses to null.
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    releaseDate: info.releaseDate ?? null,
  };
}

function toProgress(p: ProgressInfo): UpdateProgress {
  return {
    percent: p.percent,
    transferred: p.transferred,
    total: p.total,
    bytesPerSecond: p.bytesPerSecond,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const updaterManager = new UpdaterManager();
