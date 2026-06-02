import { is } from '@electron-toolkit/utils';
import log from 'electron-log/main';

/**
 * App-wide logging, on electron-log: OS-correct file path, levels, log rotation,
 * crash catching, and renderer→main forwarding (via initialize()). Modules log
 * through a scoped `createLogger(name)` so call sites stay stable and the
 * backend is swappable. File keeps info+ (durable record incl. warnings/errors);
 * console is chatty in dev, quiet in prod.
 */

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
  if (initialized) return;
  initialized = true;

  log.initialize();
  log.errorHandler.startCatching();
  log.transports.console.level = is.dev ? 'debug' : 'warn';
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.hooks.push((message) => ({ ...message, data: message.data.map(redact) }));

  // First info+ write; also creates the log file and records its path.
  log.scope('app').info('logging started:', log.transports.file.getFile().path);
}

export function createLogger(scope: string): ReturnType<typeof log.scope> {
  return log.scope(scope);
}

/**
 * Minimal logger shape for modules that are unit-tested under bun (no Electron):
 * they take a Logger by injection (type-only import, so they never pull in
 * electron-log at runtime) and default to `console`. `console` satisfies it.
 */
export type Logger = Pick<ReturnType<typeof createLogger>, 'error' | 'warn' | 'info' | 'debug'>;
