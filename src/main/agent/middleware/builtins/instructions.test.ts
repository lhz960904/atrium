import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import type { RunContext } from '../types';
import { instructionsMiddleware } from './instructions';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'instr-mw-'));
  created.push(d);
  return d;
}
const userMsg = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
});
function ctxWith(messages: UIMessage[], workspaceRoot: string): RunContext {
  return { workspaceRoot, request: { messages, system: '', tools: {} } } as unknown as RunContext;
}

test('injects <custom-instructions> with a file block into the first user message', async () => {
  const root = await tmp();
  const ws = join(root, 'ws');
  await mkdir(ws, { recursive: true });
  await writeFile(join(ws, 'AGENTS.md'), 'be concise', 'utf8');

  const ctx = ctxWith([userMsg('hi')], ws);
  await instructionsMiddleware({ home: join(root, 'home') }).beforeRun?.(ctx);

  const text = (ctx.request.messages[0].parts[0] as { text: string }).text;
  expect(text).toContain('<custom-instructions>');
  expect(text).toContain('OVERRIDE any default behavior');
  expect(text).toContain(`Contents of ${join(ws, 'AGENTS.md')}:`);
  expect(text).toContain('be concise');
  expect((ctx.request.messages[0].parts[1] as { text: string }).text).toBe('hi');
});

test('no instruction files → messages untouched', async () => {
  const root = await tmp();
  const original = [userMsg('hi')];
  const ctx = ctxWith(original, join(root, 'empty-ws'));

  await instructionsMiddleware({ home: join(root, 'home') }).beforeRun?.(ctx);

  expect(ctx.request.messages).toBe(original);
});
