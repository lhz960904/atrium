import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Db } from '@main/db';
import * as schema from '@main/db/schema';
import type { ToolName } from '@shared/tools';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { AtriumTool } from '../tools/define';
import {
  assignableTools,
  BUILTIN_SUBAGENTS,
  createSubagent,
  filterToolsForSubagent,
  listSubagents,
  resolveSubagentDef,
  SUBAGENT_DENIED_TOOLS,
  type SubagentInput,
  updateSubagent,
} from './defs';

const ALL_TOOLS: ToolName[] = [
  'read_file',
  'write_file',
  'list_dir',
  'bash',
  'todo_write',
  'web_fetch',
  'web_search',
];
const parentTools = (extra: string[] = []): AtriumTool[] =>
  [...ALL_TOOLS, ...extra].map((name) => ({ name }) as AtriumTool);
const names = (tools: AtriumTool[]): string[] => tools.map((t) => t.name).sort();

const fakeDb = (row: unknown): Db =>
  ({
    select: () => ({ from: () => ({ where: () => ({ get: () => row }) }) }),
  }) as unknown as Db;

test('a def with no allow-list inherits every parent tool', () => {
  expect(names(filterToolsForSubagent(parentTools(), {}))).toEqual([...ALL_TOOLS].sort());
});

test('an allow-list narrows to exactly those tools', () => {
  const out = filterToolsForSubagent(parentTools(), {
    toolAllow: ['web_search', 'web_fetch', 'read_file', 'todo_write'],
  });
  expect(names(out)).toEqual(['read_file', 'todo_write', 'web_fetch', 'web_search']);
});

test('toolDeny removes a tool the parent has', () => {
  const out = filterToolsForSubagent(parentTools(), { toolDeny: ['bash'] });
  expect(names(out)).not.toContain('bash');
  expect(names(out)).toContain('read_file');
});

test('the always-denied tools are stripped even if the parent exposes them', () => {
  // create_subagent isn't in ToolName; the parent may still carry such tools,
  // and a subagent must never get a denied one (task / ask_clarification / …).
  const out = filterToolsForSubagent(
    parentTools(['task', 'create_subagent', 'ask_clarification']),
    {
      toolAllow: ['bash', 'task'] as ToolName[],
    },
  );
  expect(names(out)).toEqual(['bash']);
});

test('resolves built-in subagents by type, before touching the DB', () => {
  const gp = resolveSubagentDef('general-purpose', {} as Db);
  expect(gp?.toolAllow).toBeUndefined(); // inherits all

  const dr = resolveSubagentDef('deep-research', {} as Db);
  expect(dr?.toolAllow).toEqual(['web_search', 'web_fetch', 'read_file', 'todo_write']);

  // Built-in vs custom is decided by membership here, not a stored field.
  expect(Object.keys(BUILTIN_SUBAGENTS).sort()).toEqual(['deep-research', 'general-purpose']);
});

test('falls back to the DB for unknown types, mapping a row to a def', () => {
  expect(resolveSubagentDef('nope', fakeDb(undefined))).toBeUndefined();

  const row = {
    id: 'a1',
    name: 'pirate',
    description: 'talks like a pirate',
    systemPrompt: 'Arr.',
    toolAllow: ['bash'],
    toolDeny: null,
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const def = resolveSubagentDef('pirate', fakeDb(row));
  expect(def).toMatchObject({
    name: 'pirate',
    systemPrompt: 'Arr.',
    toolAllow: ['bash'],
    toolDeny: undefined,
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
  });
});

test('a row with no pinned model leaves providerId/modelId undefined', () => {
  const row = {
    id: 'b2',
    name: 'plain',
    description: 'd',
    systemPrompt: 's',
    toolAllow: null,
    toolDeny: null,
    providerId: null,
    modelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const def = resolveSubagentDef('plain', fakeDb(row));
  expect(def?.providerId).toBeUndefined();
  expect(def?.modelId).toBeUndefined();
});

/**
 * Names, which the router used to guard. A name has to resolve to exactly one
 * definition: `resolveSubagentDef` answers with the built-in first, so a custom
 * row sharing a built-in's name would be unreachable, not merely confusing.
 */

function subagentStore(): Db {
  const raw = new Database(':memory:');
  raw.run(`CREATE TABLE subagents (
    id text PRIMARY KEY NOT NULL, name text NOT NULL, description text NOT NULL,
    system_prompt text NOT NULL, tool_allow text, tool_deny text,
    provider_id text, model_id text,
    created_at integer DEFAULT 0 NOT NULL, updated_at integer DEFAULT 0 NOT NULL)`);
  return drizzle(raw, { schema, casing: 'snake_case' }) as unknown as Db;
}

const definition = (name: string): SubagentInput => ({
  name,
  description: 'does a thing',
  systemPrompt: 'be useful',
  toolAllow: null,
  toolDeny: null,
  providerId: null,
  modelId: null,
});

test('a custom subagent cannot take a built-in name, or another custom one', () => {
  const db = subagentStore();
  const builtin = Object.keys(BUILTIN_SUBAGENTS)[0];

  expect(() => createSubagent(db, definition(builtin))).toThrow(/built-in subagent name/);
  const id = createSubagent(db, definition('reviewer'));
  expect(() => createSubagent(db, definition('reviewer'))).toThrow(/already exists/);
  // Keeping your own name while editing something else is not a collision.
  expect(() =>
    updateSubagent(db, id, { ...definition('reviewer'), description: 'x' }),
  ).not.toThrow();
  expect(listSubagents(db).filter((s) => !s.builtin)).toHaveLength(1);
});

test('the list is built-ins then custom, with builtin derived rather than stored', () => {
  const db = subagentStore();
  createSubagent(db, definition('reviewer'));

  const rows = listSubagents(db);
  expect(rows.at(-1)).toMatchObject({ name: 'reviewer', builtin: false });
  expect(rows.filter((s) => s.builtin).length).toBe(Object.keys(BUILTIN_SUBAGENTS).length);
  // A built-in is addressed by its name, so that is also its id.
  expect(rows[0].id).toBe(rows[0].name);
});

test('the tools a custom subagent may be granted never include the denied set', () => {
  for (const tool of assignableTools()) expect(SUBAGENT_DENIED_TOOLS.has(tool)).toBe(false);
  expect(assignableTools().length).toBeGreaterThan(0);
});
