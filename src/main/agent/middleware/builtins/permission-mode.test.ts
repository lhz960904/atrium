import { expect, test } from 'bun:test';
import type { PermissionMode } from '@shared/permissions';
import type { UIMessage } from 'ai';
import type { RunContext } from '../types';
import { permissionModeMiddleware } from './permission-mode';

const userMsg = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
});
function ctxWith(messages: UIMessage[]): RunContext {
  return { request: { messages, system: '', tools: {} } } as unknown as RunContext;
}
function noteFor(mode?: PermissionMode): string {
  const ctx = ctxWith([userMsg('hi')]);
  permissionModeMiddleware(mode ? { mode } : {}).beforeRun?.(ctx);
  return (ctx.request.messages[0].parts[0] as { text: string }).text;
}

test('injects a <permission-mode> block ahead of the user text', () => {
  const ctx = ctxWith([userMsg('hi')]);
  permissionModeMiddleware({ mode: 'full-access' }).beforeRun?.(ctx);
  expect((ctx.request.messages[0].parts[0] as { text: string }).text).toContain(
    '<permission-mode>',
  );
  expect((ctx.request.messages[0].parts[1] as { text: string }).text).toBe('hi');
});

test('defaults to default mode and steers away from asking in prose', () => {
  const text = noteFor();
  expect(text).toContain('default mode');
  expect(text).toContain('ask_clarification');
});

test('each mode produces a distinct, recognisable note', () => {
  const d = noteFor('default');
  const a = noteFor('auto-review');
  const f = noteFor('full-access');
  expect(new Set([d, a, f]).size).toBe(3);
  expect(a).toContain('auto-review mode');
  expect(a).toContain('reviewer');
  expect(f).toContain('full-access mode');
});
