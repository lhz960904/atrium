import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import icon from '../../resources/icon.png?asset';
import { runDream, startDreamScheduler } from './agent/memory';
import { populateModelCatalog, startModelCatalogRefresh } from './agent/models/catalog';
import { refreshSkills } from './agent/skills/registry';
import { closeDb, openDb } from './db';
import { createLogger, initLogging } from './log';
import { resolveModel } from './providers/resolve';
import { type ChatEndpoint, startHttpServer } from './server/http';
import { getSettings, openSettings } from './settings/conf';
import { attachWindowStatePersistence, getInitialWindowState } from './settings/window-state';
import { appRouter } from './trpc/router';

function createWindow(): BrowserWindow {
  const initial = getInitialWindowState();
  const mainWindow = new BrowserWindow({
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
    mainWindow.setFullScreen(true);
  } else if (initial.maximized) {
    mainWindow.maximize();
  }
  attachWindowStatePersistence(mainWindow);

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  if (is.dev) {
    // Enable the JS Self-Profiling API (used by the dev-only __atriumProfile) by
    // injecting its Document Policy on the renderer document — set here rather
    // than via Vite's server.headers, which Electron's loader doesn't reliably
    // carry through.
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === 'mainFrame') {
        callback({
          responseHeaders: { ...details.responseHeaders, 'Document-Policy': ['js-profiling'] },
        });
        return;
      }
      callback({});
    });
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

// Held at module scope so before-quit can dispose it (kill background shells) —
// assigned once the server is up inside whenReady.
let serverEndpoint: ChatEndpoint | undefined;

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.atrium.app');
  initLogging();

  const db = openDb();
  openSettings();

  // Warm model metadata from the disk cache (falls back to the bundled
  // snapshot), then let it refresh from the litellm catalog in the background.
  populateModelCatalog();
  startModelCatalogRefresh();

  if (!safeStorage.isEncryptionAvailable()) {
    createLogger('app').warn(
      'safeStorage encryption unavailable — provider credential writes will throw.',
    );
  }

  // Agent workspace — fixed for now (aligned with ~/Documents/Codex); the
  // tools read/write/exec only inside it.
  const workspaceRoot = join(homedir(), 'Documents', 'Atrium');
  mkdirSync(workspaceRoot, { recursive: true });

  // Discover skills before serving so the first turn already sees the index.
  await refreshSkills();

  // Background memory consolidation (dream) — runs off the conversation path,
  // gated so it only fires for memory that has actually accumulated.
  startDreamScheduler({
    runDream,
    model: () => {
      try {
        const sel = getSettings().get('selectedModel', null);
        return sel ? resolveModel(db, sel.providerId, sel.modelId) : null;
      } catch {
        return null;
      }
    },
  });

  const chatEndpoint = await startHttpServer({ db, token: randomUUID(), workspaceRoot });
  serverEndpoint = chatEndpoint;

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const mainWindow = createWindow();
  createIPCHandler({
    router: appRouter,
    windows: [mainWindow],
    createContext: async () => ({ db, chatEndpoint }),
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow();
      createIPCHandler({
        router: appRouter,
        windows: [win],
        createContext: async () => ({ db, chatEndpoint }),
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  serverEndpoint?.dispose();
  closeDb();
});
