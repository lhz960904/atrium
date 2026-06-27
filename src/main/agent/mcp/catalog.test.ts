import { expect, test } from 'bun:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildCatalog } from './catalog';

const tool = (name: string): Tool => ({ name, inputSchema: { type: 'object' } });

test('buildCatalog qualifies every tool and keeps routing info', () => {
  const entries = buildCatalog([
    { id: 's1', name: 'github', tools: [tool('create_issue'), tool('list_repos')] },
  ]);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({
    qualifiedName: 'mcp__github__create_issue',
    serverId: 's1',
    serverName: 'github',
    rawName: 'create_issue',
  });
  expect(entries.map((e) => e.qualifiedName)).toEqual([
    'mcp__github__create_issue',
    'mcp__github__list_repos',
  ]);
});

test('the same tool name on two servers gets distinct qualified names', () => {
  const entries = buildCatalog([
    { id: 'a', name: 'srv', tools: [tool('run')] },
    { id: 'b', name: 'srv', tools: [tool('run')] },
  ]);
  expect(new Set(entries.map((e) => e.qualifiedName)).size).toBe(2);
  expect(entries.map((e) => e.serverId)).toEqual(['a', 'b']);
});
