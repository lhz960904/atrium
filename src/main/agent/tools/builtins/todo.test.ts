import { expect, test } from 'bun:test';
import type { Todo } from '@shared/chat-types';
import type { Message } from '@shared/protocol';
import { latestTodos, preserveTodos, renderTodos } from './todo';

const todos: Todo[] = [
  { content: 'build', status: 'in_progress' },
  { content: 'test', status: 'pending' },
];

const plan = (t: unknown): Message[] => [
  {
    role: 'assistant',
    content: [{ type: 'toolCall', id: '1', name: 'todo_write', arguments: { todos: t } }],
  } as unknown as Message,
];

test('renderTodos prints status markers', () => {
  expect(renderTodos([{ content: 'a', status: 'completed' }])).toBe('[x] a');
  expect(renderTodos(todos)).toBe('[>] build\n[ ] test');
});

test('the finder returns the most recent plan', () => {
  expect(latestTodos(plan(todos))).toEqual(todos);
});

test('the finder returns null when there is no plan', () => {
  expect(latestTodos([{ role: 'user', content: 'hi', timestamp: 0 }])).toBeNull();
});

test('a folded plan is carried forward', () => {
  const carried = preserveTodos(plan(todos), []);
  expect(carried).toContain('Current plan');
  expect(carried).toContain('[>] build');
});

test('nothing is carried when the kept window still holds the plan', () => {
  expect(preserveTodos(plan(todos), plan(todos))).toBeNull();
});

test('nothing is carried when no plan was folded', () => {
  expect(preserveTodos([], [])).toBeNull();
});
