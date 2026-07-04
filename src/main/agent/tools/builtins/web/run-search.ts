import type { WebContents } from 'electron';
import type { SearchEngine, SearchResult } from './engines';

const NAV_TIMEOUT_MS = 15_000;
// After load, the keyless engine runs a JS anomaly challenge before results
// appear; poll until they render (or give up) rather than guessing a delay.
const RESULTS_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 300;
// DDG blocks rapid-fire navigations from one client (a back-to-back second
// search fails with ERR_FAILED). Searches are serialized and spaced by at least
// this gap so a burst — e.g. a research agent firing several — doesn't trip it.
// In normal use the model's own round-trips already exceed this, so the wait
// rarely engages.
const MIN_GAP_MS = 4_000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 2_500;

// Single-file mutex: every search chains off the previous one, so only one
// hidden window ever drives DDG at a time and the next waits its turn.
let queue: Promise<unknown> = Promise.resolve();
let lastSearchEndedAt = 0;

// Electron is required lazily so this module imports cleanly outside an Electron
// runtime (e.g. the bun test runner), matching how the agent runner defers it.
function BrowserWindowCtor(): typeof import('electron').BrowserWindow {
  return (require('electron') as typeof import('electron')).BrowserWindow;
}

function abortError(): DOMException {
  return new DOMException('The web search was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Run a web search through a hidden BrowserWindow. Serialized and throttled
 * against the engine's rate limiting (see MIN_GAP_MS), with one retry on a
 * navigation failure. A real Chromium clears the bot challenge a plain fetch
 * can't; the window is always destroyed, even on error/timeout.
 *
 * The abort signal (the run's stop) is honored end-to-end: every wait rejects on
 * abort and the in-flight window is torn down, so stopping a turn mid-search
 * returns at once instead of blocking on the navigation/poll timeouts.
 */
export async function runSearch(
  engine: SearchEngine,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const run = queue.then(() => throttledSearch(engine, query, signal));
  // Keep the chain alive whatever this run does, so one failure can't wedge it.
  queue = run.catch(() => {});
  return run;
}

async function throttledSearch(
  engine: SearchEngine,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  throwIfAborted(signal);
  const sinceLast = Date.now() - lastSearchEndedAt;
  if (sinceLast < MIN_GAP_MS) await delay(MIN_GAP_MS - sinceLast, signal);
  try {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      throwIfAborted(signal);
      try {
        return await attemptSearch(engine, query, signal);
      } catch (err) {
        if (signal?.aborted) throw err; // a stop isn't a retryable failure
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) await delay(RETRY_BACKOFF_MS, signal);
      }
    }
    throw lastErr;
  } finally {
    lastSearchEndedAt = Date.now();
  }
}

async function attemptSearch(
  engine: SearchEngine,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const win = new (BrowserWindowCtor())({
    show: false,
    width: 1024,
    height: 768,
    // No images and no node integration — we only need the rendered DOM text.
    webPreferences: { images: false, nodeIntegration: false, contextIsolation: true },
  });
  // A stop mid-search destroys the window now, so the in-flight loadURL / poll
  // rejects immediately instead of running to its own multi-second timeout.
  const onAbort = (): void => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted(signal);
    const wc = win.webContents;
    await withTimeout(wc.loadURL(engine.buildUrl(query)), NAV_TIMEOUT_MS, 'navigation');
    await pollFor(wc, engine.readyExpr, RESULTS_TIMEOUT_MS, signal);
    const raw = await wc.executeJavaScript(engine.scrapeScript);
    return engine.parse(Array.isArray(raw) ? raw : []);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Resolve once the in-page count expression goes truthy, or stop at timeout. */
async function pollFor(
  wc: WebContents,
  countExpr: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const n = await wc.executeJavaScript(countExpr).catch(() => 0);
    if (n) return;
    await delay(POLL_INTERVAL_MS, signal);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}
