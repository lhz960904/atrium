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

/** Delay the first check so it doesn't compete with first paint / startup IO. */
const STARTUP_CHECK_DELAY = 4_000;
/** Re-check on a slow cadence so a long-running window still notices releases. */
const POLL_INTERVAL = 60 * 60_000;

/**
 * Wraps electron-updater in a small state machine and broadcasts every
 * transition to the renderer over a single channel, so any window (including one
 * reopened after a hide/close) re-seeds from getState() and then follows live.
 *
 * A found update always downloads in the background (autoUpdater.autoDownload),
 * so opening the dialog lands on live progress or "ready to install". Checks run
 * shortly after launch and then on a fixed interval.
 */
class UpdaterManager {
  private state: UpdaterState = {
    stage: 'idle',
    currentVersion: app.getVersion(),
    info: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
  };
  private getWindow: () => BrowserWindow | null = () => null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private wired = false;

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
    if (this.wired) return;
    this.wired = true;

    autoUpdater.logger = log;
    // Download a found update in the background so the dialog opens on progress
    // or "ready to install". autoInstallOnAppQuit stays off so the swap only
    // happens on an explicit Restart Now, never silently on quit.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => this.set({ stage: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => {
      const next = toInfo(info);
      // A poll can re-announce a version we're already fetching or have staged;
      // ignore it so the UI doesn't reset and a second download isn't kicked.
      const busyWithSame =
        (this.state.stage === 'downloading' || this.state.stage === 'downloaded') &&
        this.state.info?.version === next.version;
      if (busyWithSame) return;
      // electron-updater auto-downloads from here (autoDownload); the ensuing
      // download-progress / update-downloaded events drive the rest.
      this.set({ stage: 'available', info: next, progress: null });
    });
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

  /** Check shortly after launch, then poll on a fixed interval. */
  startAutoCheck(): void {
    setTimeout(() => void this.check(), STARTUP_CHECK_DELAY);
    this.pollTimer ??= setInterval(() => void this.check(), POLL_INTERVAL);
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** One-shot check. Silent no-op when unpacked unless FORCE_DEV_UPDATE_CONFIG. */
  async check(): Promise<void> {
    if (!this.canCheck()) return;
    try {
      await autoUpdater.checkForUpdates();
      this.set({ lastCheckedAt: Date.now() });
    } catch (err) {
      log.warn('checkForUpdates failed:', err);
      this.set({ stage: 'error', error: errorMessage(err), lastCheckedAt: Date.now() });
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
