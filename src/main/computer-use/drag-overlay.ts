import { join } from 'node:path';
import {
  COMPUTER_USE_CLOSE_OVERLAY_CHANNEL,
  COMPUTER_USE_DRAG_CHANNEL,
  COMPUTER_USE_OVERLAY_CLOSED_CHANNEL,
} from '@shared/computer-use';
import { BrowserWindow, ipcMain, screen, type WebContents } from 'electron';
import { createLogger } from '../log';

const log = createLogger('computer-use-overlay');

const WIDTH = 320;
const HEIGHT = 250;

export interface OverlayTexts {
  title: string;
  desc: string;
  name: string;
  hint: string;
  dropHead: string;
  dropHint: string;
  closeLabel: string;
}

let overlay: BrowserWindow | null = null;

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
 * which owns the i18n context.
 */
function buildHtml(texts: OverlayTexts): string {
  const t = {
    title: escapeHtml(texts.title),
    desc: escapeHtml(texts.desc),
    name: escapeHtml(texts.name),
    hint: escapeHtml(texts.hint),
    dropHead: escapeHtml(texts.dropHead),
    dropHint: escapeHtml(texts.dropHint),
    closeLabel: escapeHtml(texts.closeLabel),
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;user-select:none;-webkit-user-select:none;cursor:default}
  .card{margin:7px;padding:15px 16px;background:rgba(28,28,34,.985);border:1px solid rgba(255,255,255,.12);
    border-radius:16px;font-family:-apple-system,sans-serif;color:#f2f2f5;box-shadow:0 14px 44px rgba(0,0,0,.5)}
  .hd{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:640}
  .hd .x{margin-left:auto;width:22px;height:22px;border:0;border-radius:7px;background:transparent;color:#9a9aa2;
    font-size:15px;cursor:pointer;display:grid;place-items:center}
  .hd .x:hover{background:rgba(255,255,255,.09);color:#ddd}
  .desc{margin:8px 0 0;font-size:11.5px;color:#a6a6ad;line-height:1.55}
  .src{margin-top:12px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.3)}
  .src:active{cursor:grabbing}
  .g{width:32px;height:32px;border-radius:8px;flex-shrink:0;background:linear-gradient(140deg,#8E9BFF,#C6A2FF 55%,#F0A9C7);
    display:grid;place-items:center}
  .g svg{width:17px;height:17px;fill:#fff}
  .nm{font-weight:600;font-size:13px}
  .bd{font-size:11px;color:#9a9aa2;font-family:ui-monospace,monospace}
  .dz{margin-top:10px;border:1.5px dashed rgba(255,255,255,.18);border-radius:11px;padding:13px 12px;text-align:center}
  .dzh{display:block;font-family:ui-monospace,monospace;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
    color:#8a8a92;margin-bottom:4px}
  .dzl{font-size:11.5px;color:#9a9aa2}
  </style></head><body><div class="card">
    <div class="hd">${t.title}<button class="x" id="close" aria-label="${t.closeLabel}">✕</button></div>
    <div class="desc">${t.desc}</div>
    <div class="src" id="drag" draggable="true">
      <span class="g"><svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 1.6L10 20 5 3z"/></svg></span>
      <span><span class="nm">${t.name}</span><br><span class="bd">${t.hint}</span></span>
    </div>
    <div class="dz"><span class="dzh">${t.dropHead}</span><span class="dzl">${t.dropHint}</span></div>
  </div>
  <script>
    const send = (ch) => window.electron && window.electron.ipcRenderer.send(ch);
    document.getElementById('drag').addEventListener('dragstart', (e) => { e.preventDefault(); send('${COMPUTER_USE_DRAG_CHANNEL}'); });
    document.getElementById('close').addEventListener('click', () => send('${COMPUTER_USE_CLOSE_OVERLAY_CHANNEL}'));
  </script></body></html>`;
}

// Fixed placement for now (screen right, vertically centered). Anchoring below
// the System Settings window is the follow-up step.
function positionOverlay(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - WIDTH - 44;
  const y = workArea.y + Math.round((workArea.height - HEIGHT) / 2);
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function ensureOverlay(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay;
  overlay = new BrowserWindow({
    width: WIDTH,
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
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.on('closed', () => {
    overlay = null;
  });
  return overlay;
}

export function showDragOverlay(texts: OverlayTexts): void {
  if (process.platform !== 'darwin') return;
  const win = ensureOverlay();
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(texts))}`);
  positionOverlay(win);
  win.showInactive();
}

export function hideDragOverlay(): void {
  overlay?.hide();
}

/**
 * Wires the overlay's close button: hide it and tell the main window so its
 * AuthGuide can clear the active-grant state that opened it.
 */
export function registerDragOverlay(getMainWindow: () => WebContents | undefined): void {
  if (process.platform !== 'darwin') return;
  ipcMain.on(COMPUTER_USE_CLOSE_OVERLAY_CHANNEL, () => {
    hideDragOverlay();
    getMainWindow()?.send(COMPUTER_USE_OVERLAY_CLOSED_CHANNEL);
  });
  log.debug('drag overlay registered');
}
