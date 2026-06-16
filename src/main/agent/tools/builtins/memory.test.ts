import { expect, test } from 'bun:test';
import { memoryInputSchema } from './memory';

test('scope defaults to project, honored when given', () => {
  expect(memoryInputSchema.parse({ command: 'view' }).scope).toBe('project');
  expect(memoryInputSchema.parse({ command: 'write', scope: 'global' }).scope).toBe('global');
});

test('type only accepts known categories', () => {
  expect(memoryInputSchema.parse({ command: 'write', type: 'preference' }).type).toBe('preference');
  expect(() => memoryInputSchema.parse({ command: 'write', type: 'misc' })).toThrow();
});
