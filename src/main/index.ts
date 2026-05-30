import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import icon from '../../resources/icon.png?asset';
import { closeDb, openDb } from './db';
import { threads } from './db/schema';
import { seedMockThreads } from './db/seed';
import { startHttpServer } from './server/http';
import { openSettings } from './settings/conf';
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
    backgroundColor: '#16161B',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.atrium.app');

  const db = openDb();
  openSettings();

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[atrium] safeStorage encryption unavailable — provider credential writes will throw.',
    );
  }

  const chatEndpoint = startHttpServer({ db, token: randomUUID() });

  // Dev only: if the threads table is empty, seed it with the mock data so
  // dev sessions don't start to a blank app. Production users start empty.
  if (is.dev) {
    const existing = db.select().from(threads).limit(1).all();
    if (existing.length === 0) {
      seedMockThreads(db);
    }
  }

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
  closeDb();
});
