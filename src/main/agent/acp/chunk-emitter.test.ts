import { expect, test } from 'bun:test';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { UIMessageChunk } from 'ai';
import { ChunkEmitter } from './chunk-emitter';

type Update = SessionNotification['update'];

function run(updates: Update[]): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [];
  const e = new ChunkEmitter({ write: (c) => chunks.push(c) });
  for (const u of updates) e.handle(u);
  e.flush();
  return chunks;
}

const text = (t: string): Update => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: t },
});
const thought = (t: string): Update => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text: t },
});

test('wraps streamed text in one start/end with deltas between', () => {
  const chunks = run([text('Hel'), text('lo')]);
  expect(chunks).toEqual([
    { type: 'text-start', id: 'acp-text-1' },
    { type: 'text-delta', id: 'acp-text-1', delta: 'Hel' },
    { type: 'text-delta', id: 'acp-text-1', delta: 'lo' },
    { type: 'text-end', id: 'acp-text-1' },
  ]);
});

test('closes the open block when the kind switches (thought -> text)', () => {
  const chunks = run([thought('hmm'), text('answer')]);
  expect(chunks.map((c) => c.type)).toEqual([
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'text-start',
    'text-delta',
    'text-end',
  ]);
});

test('emits a dynamic tool-input then output, closing text around it', () => {
  const chunks = run([
    text('let me edit'),
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc1',
      title: 'Edit auth.ts',
      kind: 'edit',
      rawInput: { path: 'auth.ts' },
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      status: 'completed',
      rawOutput: { ok: true },
    },
    text('done'),
  ]);
  expect(chunks.map((c) => c.type)).toEqual([
    'text-start',
    'text-delta',
    'text-end', // closed before the tool
    'tool-input-available',
    'tool-output-available',
    'text-start',
    'text-delta',
    'text-end',
  ]);
  const toolIn = chunks.find((c) => c.type === 'tool-input-available');
  expect(toolIn).toMatchObject({
    toolCallId: 'tc1',
    toolName: 'edit',
    dynamic: true,
    title: 'Edit auth.ts',
    input: { path: 'auth.ts' },
  });
});

test('ignores in-progress tool updates (only completed/failed produce output)', () => {
  const chunks = run([
    { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Run', kind: 'execute' },
    { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'in_progress' },
  ]);
  expect(chunks.map((c) => c.type)).toEqual(['tool-input-available']);
});

test('drops empty text deltas', () => {
  expect(run([text('')])).toEqual([]);
});
