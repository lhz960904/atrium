import { expect, test } from 'bun:test';
import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import type { Db } from '../../db';
import { BUILTIN_SUBAGENTS, filterToolsForSubagent, resolveSubagentDef } from './defs';

const ALL_TOOLS: ToolName[] = [
  'read_file',
  'write_file',
  'list_dir',
  'bash',
  'todo_write',
  'web_fetch',
  'web_search',
];
const parentTools = (extra: string[] = []): Record<ToolName, Tool> =>
  Object.fromEntries([...ALL_TOOLS, ...extra].map((n) => [n, {} as Tool])) as Record<
    ToolName,
    Tool
  >;
const names = (tools: Record<ToolName, Tool>): string[] => Object.keys(tools).sort();

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
  // task / create_subagent / ask_clarification aren't in ToolName yet; the
  // parent may still carry them, and a subagent must never get them.
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
