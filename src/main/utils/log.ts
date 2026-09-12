/**
 * App-wide logging facade. The electron-log backend (and @electron-toolkit's
 * `is`) transitively `require('electron')`, which only exists in an Electron
 * runtime — importing them at module top would make every module that logs
 * unloadable under bun/plain-node. So this file imports NO electron at the top:
 * `createLogger` resolves the backend lazily and only when actually running in
 * Electron, falling back to console elsewhere. That keeps any module free to
 * `createLogger(...)` and stay unit-testable, with no test-time mocking.
 */

/** Minimal scoped-logger shape; both electron-log's scope and console satisfy it. */
export type Logger = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

type ElectronLogMain = typeof import('electron-log/main')['default'];

const inElectron = Boolean(process.versions.electron);

let backend: ElectronLogMain | null = null;
function electronLog(): ElectronLogMain {
  // Lazy + require (CJS): only reached inside Electron, never at import time.
  if (!backend) backend = require('electron-log/main').default;
  return backend as ElectronLogMain;
}

// Backstop redaction — the real defense is logging explicit fields, never raw
// credential objects. Masks the value, keeps the surrounding text readable.
const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]'],
  [/\b(Bearer)\s+[A-Za-z0-9._-]{12,}/gi, '$1 [REDACTED]'],
  [
    /\b(api[_-]?key|authorization|token|password)(["'\s:=]{1,4})([^\s"',}]{8,})/gi,
    '$1$2[REDACTED]',
  ],
];

function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
  return out;
}

let initialized = false;

export function initLogging(): void {
  if (initialized || !inElectron) return;
  initialized = true;

  const { is } = require('@electron-toolkit/utils');
  const log = electronLog();
  log.initialize();
  log.errorHandler.startCatching();
  log.transports.console.level = is.dev ? 'debug' : 'warn';
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.hooks.push((message) => ({ ...message, data: message.data.map(redact) }));

  // First info+ write; also creates the log file and records its path.
  log.scope('app').info('logging started:', log.transports.file.getFile().path);
}

export function createLogger(scope: string): Logger {
  return inElectron ? electronLog().scope(scope) : scopedConsole(scope);
}

/** Console-backed logger for non-Electron runtimes (bun tests, scripts). */
function scopedConsole(scope: string): Logger {
  const tag = `[${scope}]`;
  return {
    error: (...a) => console.error(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    info: (...a) => console.info(tag, ...a),
    debug: (...a) => console.debug(tag, ...a),
  };
}
