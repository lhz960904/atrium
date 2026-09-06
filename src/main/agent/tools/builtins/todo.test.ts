import { expect, test } from 'bun:test';
import type { Todo } from '@shared/chat-types';
import type { Message } from '@shared/protocol';
import type { ModelMessage } from 'ai';
import { latestTodos, latestTodosModel, preserveTodos, renderTodos, todoPreserver } from './todo';

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

const modelPlan = (t: unknown): ModelMessage[] => [
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: '1', toolName: 'todo_write', input: { todos: t } }],
  },
];

test('renderTodos prints status markers', () => {
  expect(renderTodos([{ content: 'a', status: 'completed' }])).toBe('[x] a');
  expect(renderTodos(todos)).toBe('[>] build\n[ ] test');
});

test('the finders return the most recent plan', () => {
  expect(latestTodos(plan(todos))).toEqual(todos);
  expect(latestTodosModel(modelPlan(todos))).toEqual(todos);
});

test('the finders return null when there is no plan', () => {
  expect(latestTodos([{ role: 'user', content: 'hi', timestamp: 0 }])).toBeNull();
  expect(
    latestTodosModel([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: '1', toolName: 'read', input: {} }],
      },
    ]),
  ).toBeNull();
});

test('a folded plan is carried forward', () => {
  const carried = preserveTodos(plan(todos), []);
  expect(carried).toContain('Current plan');
  expect(carried).toContain('[>] build');
  expect(todoPreserver(modelPlan(todos), [])).toContain('[>] build');
});

test('nothing is carried when the kept window still holds the plan', () => {
  expect(preserveTodos(plan(todos), plan(todos))).toBeNull();
  expect(todoPreserver(modelPlan(todos), modelPlan(todos))).toBeNull();
});

test('nothing is carried when no plan was folded', () => {
  expect(preserveTodos([], [])).toBeNull();
  expect(todoPreserver([], [])).toBeNull();
});
