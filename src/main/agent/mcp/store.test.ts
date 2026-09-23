import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import { Refusal } from '@main/utils/refusal';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import {
  applyServersJson,
  createServer,
  exportServersJson,
  listServers,
  type McpServerInput,
  removeServer,
  setServerEnabled,
  updateServer,
} from './store';

/**
 * The rules these pin used to live inside a tRPC handler, where the only way to
 * reach them was to send a request — so none of them had a test.
 *
 * Every case keeps `secrets` empty on purpose: a non-empty one is sealed through
 * safeStorage, which needs the app runtime. What is covered here is the decision
 * (seal or store nothing), not the sealing.
 */

function store(): { db: Db; raw: Database } {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE mcp_servers (
    id text PRIMARY KEY NOT NULL, name text NOT NULL UNIQUE,
    enabled integer DEFAULT false NOT NULL, managed integer DEFAULT false NOT NULL,
    transport text NOT NULL, config text,
    credentials_encrypted blob, oauth_encrypted blob,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL)`);
  return { db: drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db, raw };
}

const server = (over: Partial<McpServerInput> = {}): McpServerInput => ({
  name: 'files',
  enabled: true,
  transport: 'stdio',
  config: { command: 'npx', args: ['-y', 'server-filesystem'] },
  secrets: {},
  ...over,
});

test('a name another server already has is a collision, and the row is not written', () => {
  const { db } = store();
  createServer(db, server({ name: 'files' }));

  expect(() => createServer(db, server({ name: 'files', enabled: false }))).toThrow(
    /already exists/,
  );
  expect(listServers(db)).toHaveLength(1);
  // Renaming onto another server's name collides; keeping your own does not.
  const second = createServer(db, server({ name: 'other' }));
  expect(() => updateServer(db, second, server({ name: 'files' }))).toThrow(/already exists/);
  expect(() => updateServer(db, second, server({ name: 'other', enabled: false }))).not.toThrow();
});

test('a config the transport cannot accept is refused before anything is stored', () => {
  const { db } = store();
  // stdio needs a command; without one there is nothing to launch.
  expect(() => createServer(db, server({ config: {} }))).toThrow(/Invalid MCP server config/);
  expect(listServers(db)).toEqual([]);
});

test('empty secrets store no blob at all, rather than an encrypted empty one', () => {
  const { db, raw } = store();
  createServer(db, server());
  const [row] = raw.query('SELECT credentials_encrypted AS blob FROM mcp_servers').all() as {
    blob: unknown;
  }[];
  expect(row.blob).toBeNull();
});

test('a managed server refuses every edit, and is still listed', () => {
  const { db, raw } = store();
  const id = createServer(db, server({ name: 'browser' }));
  raw.query('UPDATE mcp_servers SET managed = 1 WHERE id = ?').run(id);

  expect(() => updateServer(db, id, server({ name: 'browser' }))).toThrow(/managed/);
  expect(() => setServerEnabled(db, id, false)).toThrow(/managed/);
  expect(() => removeServer(db, id)).toThrow(/managed/);
  // Read-only, not hidden: the settings list still shows it.
  expect(listServers(db)).toMatchObject([{ id, managed: true }]);
});

test('a managed server is left out of the exported JSON', () => {
  const { db, raw } = store();
  createServer(db, server({ name: 'files' }));
  const id = createServer(db, server({ name: 'browser' }));
  raw.query('UPDATE mcp_servers SET managed = 1 WHERE id = ?').run(id);

  const json = exportServersJson(db);
  expect(json).toContain('files');
  expect(json).not.toContain('browser');
});

test('applying JSON is the full desired state: create, update, delete by name', () => {
  const { db } = store();
  const kept = createServer(db, server({ name: 'files' }));
  createServer(db, server({ name: 'stale' }));

  const result = applyServersJson(
    db,
    JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['-y', 'other'] },
        fresh: { command: 'uvx', args: ['thing'] },
      },
    }),
  );

  expect(result).toMatchObject({ created: ['fresh'], updated: ['files'], deleted: ['stale'] });
  const names = listServers(db).map((s) => s.name);
  expect(names.sort()).toEqual(['files', 'fresh']);
  // Updating matches by name, so the row — and its id — survives.
  expect(listServers(db).find((s) => s.name === 'files')?.id).toBe(kept);
});

test('applying JSON neither edits nor deletes a managed server', () => {
  const { db, raw } = store();
  const id = createServer(db, server({ name: 'browser' }));
  raw.query('UPDATE mcp_servers SET managed = 1 WHERE id = ?').run(id);

  // The JSON does not name it, which for a user server would mean "delete".
  const result = applyServersJson(
    db,
    JSON.stringify({ mcpServers: { files: { command: 'npx', args: [] } } }),
  );

  expect(result.deleted).toEqual([]);
  expect(listServers(db).find((s) => s.id === id)).toMatchObject({ managed: true });
});

test('JSON that does not parse is refused without touching a row', () => {
  const { db } = store();
  createServer(db, server({ name: 'files' }));
  expect(() => applyServersJson(db, '{ not json')).toThrow(Refusal);
  expect(listServers(db)).toHaveLength(1);
});
