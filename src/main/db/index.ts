import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { app } from 'electron';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
let _raw: Database.Database | null = null;

function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle', 'migrations')
    : join(app.getAppPath(), 'drizzle', 'migrations');
}

export function openDb(): Db {
  if (_db) return _db;

  const dbPath = join(app.getPath('userData'), 'atrium.db');
  _raw = new Database(dbPath);
  _raw.pragma('journal_mode = WAL');
  _raw.pragma('foreign_keys = ON');
  _db = drizzle(_raw, { schema, casing: 'snake_case' });

  migrate(_db, { migrationsFolder: migrationsFolder() });

  return _db;
}

export function getDb(): Db {
  if (!_db) throw new Error('DB not initialized — call openDb() first');
  return _db;
}

export function closeDb(): void {
  _raw?.close();
  _raw = null;
  _db = null;
}

export { schema };
