import { expect, test } from 'bun:test';
import { todoWriteTool } from './todo-write';

// biome-ignore lint/suspicious/noExplicitAny: tool.execute's option arg is irrelevant to these tests
const opts = {} as any;

test('echoes a compact summary with the completed count', async () => {
  const t = todoWriteTool();
  const out = (await t.execute?.(
    {
      todos: [
        { content: 'read config', status: 'completed' },
        { content: 'migrate styles', status: 'in_progress' },
        { content: 'run tests', status: 'pending' },
      ],
    },
    opts,
  )) as string;
  expect(out).toBe('Plan updated · 1/3 done\n[x] read config\n[>] migrate styles\n[ ] run tests');
});

test('handles an all-done plan', async () => {
  const t = todoWriteTool();
  const out = (await t.execute?.(
    { todos: [{ content: 'a', status: 'completed' }] },
    opts,
  )) as string;
  expect(out).toBe('Plan updated · 1/1 done\n[x] a');
});
