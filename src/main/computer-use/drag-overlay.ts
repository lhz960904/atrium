import { join } from 'node:path';
import {
  COMPUTER_USE_CLOSE_OVERLAY_CHANNEL,
  COMPUTER_USE_DRAG_CHANNEL,
  COMPUTER_USE_OVERLAY_CLOSED_CHANNEL,
} from '@shared/computer-use';
import { app, BrowserWindow, ipcMain, type Rectangle, screen } from 'electron';
import { createLogger } from '../log';
import { resolveSelfBundlePath } from './drag';
import { getComputerUseHelper } from './index';

const log = createLogger('computer-use-overlay');

const HEIGHT = 104;
const FALLBACK_WIDTH = 380;
const GAP = 12;
const POLL_MS = 250;
// System Settings' sidebar is a fixed width; the overlay aligns to the content
// column on its right, not the whole window, so it never spans the menu.
const SIDEBAR_WIDTH = 220;
const MIN_WIDTH = 320;
const SETTINGS_BUNDLE_ID = 'com.apple.systempreferences';

let overlay: BrowserWindow | null = null;
let followTimer: ReturnType<typeof setInterval> | null = null;
let resolveMainWindow: (() => BrowserWindow | undefined) | null = null;
// The real app icon (dev: Electron.app, packaged: Atrium.app) as a data URL, so
// the drag source shows the same icon that lands in the privacy list.
let iconDataUrl = '';

async function loadIcon(): Promise<void> {
  try {
    // 'normal' (not 'large' — that can hard-crash the process on macOS).
    const icon = await app.getFileIcon(resolveSelfBundlePath(), { size: 'normal' });
    if (!icon.isEmpty()) iconDataUrl = icon.toDataURL();
  } catch (err) {
    log.warn('getFileIcon for overlay failed', err);
  }
}
// Last applied / candidate placement keys, used to skip the mid-animation frames
// while a Space switch is settling so the overlay lands in one hop, not several.
let appliedKey: string | null = null;
let pendingKey: string | null = null;

export interface OverlayTexts {
  heading: string;
  name: string;
  dragLabel: string;
  closeLabel: string;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}

/**
 * The overlay is a bare data-URL page rather than a renderer route: it must be a
 * lightweight, always-on-top, non-activating window that floats over System
 * Settings, and reusing the app's root would drag in the whole shell (sidebar,
 * global shortcuts, i18n boot). Localized strings are injected by the caller,
 * which owns the i18n context. Laid out as a short, full-width bar so it fits
 * below the Settings window without the pane needing to move up.
 */
function buildHtml(texts: OverlayTexts): string {
  const t = {
    heading: escapeHtml(texts.heading),
    name: escapeHtml(texts.name),
    dragLabel: escapeHtml(texts.dragLabel),
    closeLabel: escapeHtml(texts.closeLabel),
  };
  const iconEl = iconDataUrl
    ? `<img class="ico" src="${iconDataUrl}" alt="" />`
    : `<span class="ico ph"><svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 1.6L10 20 5 3z"/></svg></span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--bg:rgba(30,30,36,.985);--border:rgba(255,255,255,.12);--fg:#f2f2f5;--tip:#c8c8cf;--x:#9a9aa2;
    --xh:rgba(255,255,255,.09);--xhf:#ddd;--bar:rgba(255,255,255,.06);--barb:rgba(255,255,255,.12);
    --grip:rgba(255,255,255,.1);--gripf:#d2d2d8;--nm:#ffffff;--shadow:0 14px 44px rgba(0,0,0,.5)}
  @media (prefers-color-scheme: light){:root{--bg:rgba(252,252,254,.99);--border:rgba(0,0,0,.1);--fg:#1d1d1f;
    --tip:#3c3c43;--x:#8e8e93;--xh:rgba(0,0,0,.06);--xhf:#1d1d1f;--bar:rgba(0,0,0,.035);--barb:rgba(0,0,0,.09);
    --grip:rgba(0,0,0,.06);--gripf:#6e6e73;--nm:#1d1d1f;--shadow:0 12px 40px rgba(0,0,0,.2)}}
  html,body{margin:0;background:transparent;user-select:none;-webkit-user-select:none;cursor:default}
  .card{margin:2px 0 9px;padding:11px 14px;background:var(--bg);border:1px solid var(--border);
    border-radius:15px;font-family:-apple-system,sans-serif;color:var(--fg);box-shadow:var(--shadow)}
  .hd{display:flex;align-items:center;gap:8px}
  .tip{flex:1;min-width:0;font-size:12px;color:var(--tip);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .x{flex-shrink:0;width:22px;height:22px;border:0;border-radius:7px;background:transparent;color:var(--x);
    font-size:15px;cursor:pointer;display:grid;place-items:center}
  .x:hover{background:var(--xh);color:var(--xhf)}
  .bar{margin-top:9px;width:100%;display:flex;align-items:center;gap:11px;padding:8px 10px 8px 11px;border-radius:11px;
    background:var(--bar);border:1px solid var(--barb);cursor:grab}
  .bar:active{cursor:grabbing}
  .ico{width:30px;height:30px;border-radius:8px;flex-shrink:0}
  .ico.ph{background:linear-gradient(140deg,#8E9BFF,#C6A2FF 55%,#F0A9C7);display:grid;place-items:center}
  .ico.ph svg{width:16px;height:16px;fill:#fff}
  .nm{flex:1;min-width:0;text-align:left;font-weight:600;font-size:13px;color:var(--nm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .grip{flex-shrink:0;display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;
    background:var(--grip);font-size:11px;color:var(--gripf)}
  .grip svg{width:14px;height:14px;fill:currentColor}
  </style></head><body><div class="card">
    <div class="hd"><span class="tip">${t.heading}</span><button class="x" id="close" aria-label="${t.closeLabel}">✕</button></div>
    <button class="bar" id="drag" draggable="true" type="button">
      ${iconEl}
      <span class="nm">${t.name}</span>
      <span class="grip"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>${t.dragLabel}</span>
    </button>
  </div>
  <script>
    const send = (ch) => window.electron && window.electron.ipcRenderer.send(ch);
    document.getElementById('drag').addEventListener('dragstart', (e) => { e.preventDefault(); send('${COMPUTER_USE_DRAG_CHANNEL}'); });
    document.getElementById('close').addEventListener('click', () => send('${COMPUTER_USE_CLOSE_OVERLAY_CHANNEL}'));
  </script></body></html>`;
}

async function settingsBounds(): Promise<Rectangle | null> {
  try {
    const res = await getComputerUseHelper().call('get_window_bounds', {
      bundleId: SETTINGS_BUNDLE_ID,
    });
    const data = (res.result as { data?: Partial<Rectangle> & { found?: boolean } })?.data;
    if (
      data?.found &&
      typeof data.x === 'number' &&
      typeof data.y === 'number' &&
      typeof data.width === 'number' &&
      typeof data.height === 'number'
    ) {
      return { x: data.x, y: data.y, width: data.width, height: data.height };
    }
  } catch (err) {
    log.warn('get_window_bounds failed', err);
  }
  return null;
}

/**
 * A full-width bar matching the Settings window (same x + width, right edges
 * aligned) parked just below it. Short enough that it almost always fits; if the
 * window sits too low it clamps to the screen bottom. Coordinates are top-left
 * points, matching both CGWindowList (helper) and Electron's screen space.
 */
function place(settings: Rectangle): Rectangle {
  const area = screen.getDisplayMatching(settings).workArea;
  // Align to the content column: skip the fixed sidebar, keep the right edge.
  const width = Math.max(MIN_WIDTH, settings.width - SIDEBAR_WIDTH);
  const x = Math.min(Math.max(settings.x + SIDEBAR_WIDTH, area.x), area.x + area.width - width);
  const belowY = settings.y + settings.height + GAP;
  const y = Math.min(Math.max(belowY, area.y), area.y + area.height - HEIGHT);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: HEIGHT };
}

/**
 * Reconciles the overlay to System Settings each tick. CGWindowList only reports
 * windows on the *current* Space, so when Settings isn't visible here — another
 * app is fullscreen, or Settings is on a different desktop — the lookup misses
 * and the overlay hides itself rather than floating over the wrong app. When it
 * reappears, placement waits one tick for the frame to settle so a Space switch
 * lands in a single hop, not several.
 */
async function syncOverlay(win: BrowserWindow, immediate = false): Promise<void> {
  const settings = await settingsBounds();
  if (win.isDestroyed()) return;
  if (!settings) {
    if (win.isVisible()) win.hide();
    appliedKey = null;
    pendingKey = null;
    return;
  }
  const target = place(settings);
  const key = `${target.x},${target.y},${target.width}`;
  const reveal = () => {
    if (!win.isVisible()) win.showInactive();
  };
  if (key === appliedKey) {
    pendingKey = null;
    reveal();
    return;
  }
  if (!immediate && key !== pendingKey) {
    pendingKey = key;
    return;
  }
  appliedKey = key;
  pendingKey = null;
  win.setBounds(target);
  reveal();
}

function startFollow(win: BrowserWindow): void {
  stopFollow();
  followTimer = setInterval(() => {
    if (win.isDestroyed()) {
      stopFollow();
      return;
    }
    void syncOverlay(win);
  }, POLL_MS);
}

function stopFollow(): void {
  if (followTimer) {
    clearInterval(followTimer);
    followTimer = null;
  }
}

// Hide/restore the main window while the drag overlay is up, so System Settings
// isn't covered by the (often maximized) Atrium window. While hidden, disable
// background throttling so the renderer keeps polling permissions and can
// auto-restart the moment the grant lands, instead of stalling behind Chromium's
// hidden-window timer throttle.
function parkMainWindow(hidden: boolean): void {
  const mw = resolveMainWindow?.();
  if (!mw) return;
  mw.webContents.setBackgroundThrottling(!hidden);
  if (hidden) mw.hide();
  else mw.show();
}

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    width: FALLBACK_WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    focusable: false, // non-activating: keeps System Settings focused
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  });
  // screen-saver level floats it above Settings within the Space, but NOT across
  // Spaces — no setVisibleOnAllWorkspaces — so it never intrudes on a fullscreen
  // app; syncOverlay hides it whenever Settings isn't on the current Space.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.on('closed', () => {
    overlay = null;
  });
  return overlay;
}

export async function showDragOverlay(texts: OverlayTexts): Promise<void> {
  if (process.platform !== 'darwin') return;
  appliedKey = null;
  pendingKey = null;
  const win = ensureOverlay();
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(texts))}`);
  // Get the main window out of the way so System Settings comes to the front:
  // otherwise the maximized Atrium window (and the runtime dialog) covers it, and
  // there's nothing above the overlay to drop onto. The overlay is its own
  // always-on-top window, so it stays visible; hideDragOverlay brings it back.
  parkMainWindow(true);
  // syncOverlay reveals it only if Settings is already on this Space; otherwise
  // the follow loop shows it the moment Settings appears here.
  await syncOverlay(win, true);
  startFollow(win);
}

export function hideDragOverlay(): void {
  stopFollow();
  appliedKey = null;
  pendingKey = null;
  overlay?.hide();
  parkMainWindow(false);
}

/**
 * Wires the overlay's close button: hide it and tell the main window so its
 * AuthGuide can clear the active-grant state that opened it.
 */
export function registerDragOverlay(getMainWindow: () => BrowserWindow | undefined): void {
  if (process.platform !== 'darwin') return;
  resolveMainWindow = getMainWindow;
  void loadIcon();
  ipcMain.on(COMPUTER_USE_CLOSE_OVERLAY_CHANNEL, () => {
    hideDragOverlay();
    getMainWindow()?.webContents.send(COMPUTER_USE_OVERLAY_CLOSED_CHANNEL);
  });
  log.debug('drag overlay registered');
}
