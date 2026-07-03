/**
 * IPC contract for the auto-updater. This DTO crosses the main→renderer boundary
 * as plain JSON, so the renderer depends only on this shape and never imports
 * electron-updater (which requires the Electron runtime). electron-updater's own
 * UpdateInfo / ProgressInfo carry fields the UI doesn't need, so the main process
 * maps them down to this before broadcasting.
 */

export const UPDATE_STATE_CHANNEL = 'update:state';

export type UpdaterStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type UpdateAvailableInfo = {
  version: string;
  releaseNotes: string | null;
  releaseDate: string | null;
};

export type UpdaterState = {
  stage: UpdaterStage;
  currentVersion: string;
  info: UpdateAvailableInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  /** Epoch ms of the last completed check (success or failure); null = never. */
  lastCheckedAt: number | null;
};
