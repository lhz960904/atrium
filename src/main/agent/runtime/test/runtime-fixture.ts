import { Database } from 'bun:sqlite';
import { mock, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { SqliteSessionRepository } from '@earendil-works/pi-session-backend-sqlite-node';
import { sessionSqlite } from '@main/conversation/store/sqlite-driver';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { drizzle } from 'drizzle-orm/bun-sqlite';

// Only the desktop host is absent under Bun. Settings are stubbed below; no
// test may discover or write the user's actual Electron profile.
mock.module('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('No Electron profile in runtime tests');
    },
  },
  BrowserWindow: class {},
  ipcMain: {},
  nativeImage: {},
  screen: {},
  desktopCapturer: {},
  systemPreferences: {},
  powerMonitor: {},
  safeStorage: {},
  shell: {},
  session: {},
}));

const settings = await import('@main/settings/conf');
const sessions = await import('@main/conversation/store/session');
const threadRows = await import('@main/conversation/store/threads');
const context = await import('../../context/injectors');
const { piModels } = await import('../../providers/registry');
const { BackgroundShells } = await import('../../sandbox');

const disposers: Array<() => Promise<void>> = [];
export async function cleanupRuntime() {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  mock.restore();
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function runtimeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-runtime-'));
  const databasePath = join(dir, 'data.db');
  const raw = new Database(databasePath);
  raw.exec(`
    CREATE TABLE threads (
      id text PRIMARY KEY, title text, project_id text, metadata text,
      model_provider_id text, model_id text, session_id text,
      created_at integer DEFAULT 0, updated_at integer DEFAULT 0,
      last_read_at integer, archived_at integer, pinned integer DEFAULT 0);
    CREATE TABLE projects (id text PRIMARY KEY, path text);
    CREATE TABLE providers (id text PRIMARY KEY, config text);
    CREATE TABLE subagents (
      id text PRIMARY KEY, name text, description text, system_prompt text,
      tool_allow text, tool_deny text, provider_id text, model_id text,
      created_at integer, updated_at integer);
    CREATE TABLE usage (
      id text PRIMARY KEY, thread_id text, message_id text, provider_id text, model_id text,
      kind text, input_tokens integer, output_tokens integer, cache_read_tokens integer,
      cache_creation_tokens integer, total_tokens integer, cost_usd_micros integer,
      created_at integer DEFAULT 0);
  `);
  const db = drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
  const repo = new SqliteSessionRepository({
    env: new NodeExecutionEnv({ cwd: dir }),
    sqlite: sessionSqlite(raw),
    databasePath,
  });
  // A module singleton outlives mock.restore(), so it is installed and cleared
  // explicitly rather than spied — otherwise one fixture's store leaks into the
  // next test.
  threadRows.openThreadStore(db);
  sessions.openConversations(repo);
  const config: Record<string, unknown> = {
    'computerUse.enabled': false,
    'general.autoGenerateTitle': false,
    'permissions.trustRules': [],
  };
  spyOn(settings, 'getSettings').mockImplementation(
    ((key: string) => config[key]) as typeof settings.getSettings,
  );
  const blocks = spyOn(context, 'loadContextBlocks').mockResolvedValue([]);
  const faux = fauxProvider({ provider: `runtime-${crypto.randomUUID()}` });
  piModels.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage('Hello world')]);
  const model = faux.getModel();
  const bgShells = new BackgroundShells();
  disposers.push(async () => {
    sessions.closeConversations();
    threadRows.closeThreadStore();
    bgShells.killAll();
    piModels.deleteProvider(model.provider);
    await repo.close();
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const addThread = (id: string) => db.insert(schema.threads).values({ id }).run();
  addThread('t1');
  const request = {
    threadId: 't1',
    providerId: model.provider,
    modelId: model.id,
    userMessage: {
      id: 'u1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'hi' }],
    },
  };
  return { db, raw, repo, dir, faux, model, bgShells, config, blocks, request, addThread };
}
