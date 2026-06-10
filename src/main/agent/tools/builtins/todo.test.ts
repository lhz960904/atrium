import { expect, test } from 'bun:test';
import type { Todo } from '@shared/chat-types';
import type { ModelMessage, UIMessage } from 'ai';
import { latestTodosModel, latestTodosUI, renderTodos, todoPreserver } from './todo';

const todos: Todo[] = [
  { content: 'build', status: 'in_progress' },
  { content: 'test', status: 'pending' },
];

const uiPlan = (t: unknown): UIMessage[] =>
  [
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-todo_write',
          toolCallId: '1',
          state: 'output-available',
          input: { todos: t },
        },
      ],
    },
  ] as unknown as UIMessage[];

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

test('latestTodosUI / latestTodosModel find the most recent plan', () => {
  expect(latestTodosUI(uiPlan(todos))).toEqual(todos);
  expect(latestTodosModel(modelPlan(todos))).toEqual(todos);
});

test('finders return null when there is no plan', () => {
  expect(
    latestTodosUI([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ] as unknown as UIMessage[]),
  ).toBeNull();
  expect(
    latestTodosModel([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: '1', toolName: 'read', input: {} }],
      },
    ]),
  ).toBeNull();
});

test('todoPreserver carries a folded plan forward', () => {
  const carried = todoPreserver.fromUI(uiPlan(todos), []);
  expect(carried).toContain('Current plan');
  expect(carried).toContain('[>] build');
});

test('todoPreserver skips when the kept window still holds the plan', () => {
  expect(todoPreserver.fromUI(uiPlan(todos), uiPlan(todos))).toBeNull();
  expect(todoPreserver.fromModel(modelPlan(todos), modelPlan(todos))).toBeNull();
});

test('todoPreserver returns null when no plan was folded', () => {
  expect(todoPreserver.fromModel([], [])).toBeNull();
});
