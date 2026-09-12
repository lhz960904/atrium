import { mock } from 'bun:test';

/**
 * The SQLite session backend's entry point imports `node:sqlite` to offer a
 * driver built on it. Bun has no such builtin, and we never use that driver —
 * the backend runs on the app's own better-sqlite3 connection — so the import
 * only has to resolve. Electron ships the real module, so this shim never
 * reaches anything but the test run.
 */
mock.module('node:sqlite', () => ({
  DatabaseSync: class {},
  StatementSync: class {},
}));
