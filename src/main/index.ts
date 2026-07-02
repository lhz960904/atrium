import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import icon from '../../resources/icon.png?asset';
import { mcpManager } from './agent/mcp/manager';
import { runDream, startDreamScheduler } from './agent/memory';
import { populateModelCatalog, startModelCatalogRefresh } from './agent/models/catalog';
import { scheduledManager, startScheduledTasks } from './agent/scheduled';
import { refreshSkills } from './agent/skills/registry';
import { closeDb, openDb } from './db';
import { initLogging } from './log';
import { setupMenuBar } from './menu-bar';
import { notifyScheduledRun } from './notifications';
import { firstEnabledModel, resolveModel } from './providers/resolve';
import { type ChatEndpoint, startHttpServer } from './server/http';
import { getRunningThreadIds } from './server/resumable';
import { getSettings, openSettings } from './settings/conf';
import { attachWindowStatePersistence, getInitialWindowState } from './settings/window-state';
import { loadShellEnv } from './shell-path';
import { appRouter } from './trpc/router';

// Kept alive across hide/show so reopening from the Dock restores the exact
// prior view instead of booting a fresh window. isQuitting lets the real quit
// (Cmd+Q / before-quit) bypass the hide-on-close interception below.
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow(): BrowserWindow {
  const initial = getInitialWindowState();
  const win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: 880,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 19, y: 18 },
    backgroundColor: '#16161B',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Chromium's built-in PDF viewer (used to preview PDF attachments in an
      // iframe) needs plugins enabled.
      plugins: true,
    },
  });

  // Fullscreen takes precedence over maximize — they're mutually exclusive
  // on macOS, and entering fullscreen on a non-maximized window gives the
  // user the Space-aware mode they expect.
  if (initial.fullscreen) {
    win.setFullScreen(true);
  } else if (initial.maximized) {
    win.maximize();
  }
  attachWindowStatePersistence(win);

  win.on('ready-to-show', () => {
    win.show();
  });

  // On macOS the red traffic light hides the window rather than destroying it,
  // keeping the renderer (route, scroll, in-flight state) alive so reopening
  // from the Dock lands back on the previous page. The OS convention is for the
  // app to stay resident until Cmd+Q.
  win.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      // Hiding a window that's in a native fullscreen Space blacks out the
      // screen — the empty Space lingers with nothing left to show. Leave
      // fullscreen first and hide only once the (async) Space transition ends.
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = win;
  return win;
}

// Held at module scope so before-quit can dispose it (kill background shells) —
// assigned once the server is up inside whenReady.
let serverEndpoint: ChatEndpoint | undefined;

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.atrium.app');
  // Dev runs from the Electron binary, so the Dock shows its default icon until
  // we set ours explicitly; packaged macOS builds already carry build/icon.icns.
  if (process.platform === 'darwin') app.dock?.setIcon(icon);
  initLogging();

  const db = openDb();
  openSettings();

  // Fallback workspace root for projectless conversations; project-scoped
  // threads run in their project's directory instead, resolved per request.
  const projectlessRoot = join(homedir(), 'Documents', 'Atrium');
  mkdirSync(projectlessRoot, { recursive: true });

  // Bring the chat server up first — it's a fast port bind — so the IPC handler
  // attaches before the window paints and the renderer's first tRPC calls never
  // race a missing handler.
  const chatEndpoint = await startHttpServer({ db, token: randomUUID(), projectlessRoot });
  serverEndpoint = chatEndpoint;

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Paint the window now. Everything slow or spawn-related below runs off the
  // critical path, so first paint no longer waits on the login shell (seconds
  // behind a heavy rc) or the skills scan.
  const win = createWindow();
  createIPCHandler({
    router: appRouter,
    windows: [win],
    createContext: async () => ({ db, chatEndpoint }),
  });

  // Resolve the user's login-shell environment in the background so PATH and
  // their exported vars match the terminal. It can take seconds behind a slow
  // rc, so nothing awaits it except the subprocess-spawning init below.
  const shellEnvReady = loadShellEnv();

  // Warm model metadata from the disk cache (falls back to the bundled
  // snapshot), then let it refresh from the litellm catalog in the background.
  populateModelCatalog();
  startModelCatalogRefresh();

  // Connect configured MCP servers once the shell env is merged — stdio servers
  // read PATH from process.env at spawn, so they must not start before it. A
  // slow or failing server never blocks startup.
  void shellEnvReady.then(() => mcpManager.init(db));

  // Discover skills in the background, off the critical path. The scheduler
  // (below) waits on this so a boot-time catch-up run still sees the full index;
  // interactive turns already outlast the scan.
  const skillsReady = refreshSkills();

  // Background memory consolidation (dream) — runs off the conversation path,
  // gated so it only fires for memory that has actually accumulated.
  startDreamScheduler({
    runDream,
    model: () => {
      try {
        const sel = getSettings('general.selectedModel');
        return sel ? resolveModel(db, sel.providerId, sel.modelId) : null;
      } catch {
        return null;
      }
    },
  });

  // Show (or, after a full quit cycle / non-macOS, rebuild) the main window.
  // Hide-on-close keeps it alive, so the common path just re-shows it.
  const showWindow = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    const next = createWindow();
    createIPCHandler({
      router: appRouter,
      windows: [next],
      createContext: async () => ({ db, chatEndpoint }),
    });
  };

  // Scheduled tasks drive the same chat server headlessly. Start them once skills
  // are discovered — the chat server is already listening, and gating on the scan
  // keeps a boot-time catch-up run from firing before the skill index exists. Run
  // even if discovery rejects (a failed scan must not strand the scheduler).
  const startScheduler = (): void => {
    startScheduledTasks({
      db,
      endpoint: { port: chatEndpoint.port, token: chatEndpoint.token },
      runningThreadIds: getRunningThreadIds,
      defaultModel: () => {
        // The renderer only persists general.selectedModel on an explicit pick, so
        // it can be null even when the user has a working model — fall back to the
        // first enabled one so a headless run isn't blocked on "no model".
        try {
          return getSettings('general.selectedModel') ?? firstEnabledModel(db);
        } catch {
          return null;
        }
      },
      onComplete: (task, run) => {
        notifyScheduledRun({
          title: task.title,
          threadId: task.threadId,
          status: run.status,
          onOpen: (threadId) => {
            showWindow();
            mainWindow?.webContents.send('scheduled:open-thread', threadId);
          },
        });
      },
    });
  };
  void skillsReady.then(startScheduler, startScheduler);

  setupMenuBar({
    showWindow,
    newChat: () => {
      showWindow();
      mainWindow?.webContents.send('menu:new-chat');
    },
  });

  app.on('activate', showWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  serverEndpoint?.dispose();
  scheduledManager.dispose();
  void mcpManager.dispose();
  closeDb();
});
