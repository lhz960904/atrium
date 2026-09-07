import { expect, test } from 'bun:test';
import { runTool } from '../testing';
import { todoWriteTool } from './todo-write';

test('echoes a compact summary with the completed count', async () => {
  const t = todoWriteTool();
  const out = (await runTool(t, {
    todos: [
      { content: 'read config', status: 'completed' },
      { content: 'migrate styles', status: 'in_progress' },
      { content: 'run tests', status: 'pending' },
    ],
  })) as string;
  expect(out).toBe('Plan updated · 1/3 done\n[x] read config\n[>] migrate styles\n[ ] run tests');
});

test('handles an all-done plan', async () => {
  const t = todoWriteTool();
  const out = (await runTool(t, { todos: [{ content: 'a', status: 'completed' }] })) as string;
  expect(out).toBe('Plan updated · 1/1 done\n[x] a');
});
