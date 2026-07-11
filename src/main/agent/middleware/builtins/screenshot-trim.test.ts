import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import type { RunContext } from '../types';
import { screenshotTrimMiddleware } from './screenshot-trim';

function freshCtx(): RunContext {
  return {
    workspaceRoot: mkdtempSync(join(tmpdir(), 'shot-trim-')),
    scratch: new Map(),
  } as unknown as RunContext;
}

/** A computer-tool result: state text (AX tree) plus a screenshot. */
function shot(n: number): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: `c${n}`,
        toolName: 'computer_get_app_state',
        output: {
          type: 'content',
          value: [
            { type: 'text', text: `state ${n}` },
            { type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/png' },
          ],
        },
      },
    ],
  } as unknown as ModelMessage;
}

function imageCount(messages: ModelMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      const value = (part as { output?: { value?: { type?: string }[] } }).output?.value;
      if (Array.isArray(value)) count += value.filter((v) => v.type === 'image-data').length;
    }
  }
  return count;
}

const run = (ctx: RunContext, keep: number, messages: ModelMessage[]) =>
  screenshotTrimMiddleware(keep).beforeStep?.(ctx, { stepNumber: messages.length, messages });

test('keeps last N screenshots; older ones spill to a view_image note', async () => {
  const ctx = freshCtx();
  const messages: ModelMessage[] = [
    { role: 'user', content: 'do it' },
    shot(1),
    shot(2),
    shot(3),
    shot(4),
  ];
  const out = await run(ctx, 2, messages);
  const trimmed = out?.messages;
  expect(trimmed).toBeDefined();
  if (!trimmed) return;

  // Only the last 2 screenshots remain as images.
  expect(imageCount(trimmed)).toBe(2);
  const dump = JSON.stringify(trimmed);
  // Older ones became a note pointing at a spilled path + view_image.
  expect(dump).toContain('view_image');
  expect(dump).toContain('.atrium/media');
  // Recent images kept, and text state preserved for the trimmed steps too.
  expect(dump).toContain('state 3');
  expect(dump).toContain('state 4');
  expect(dump).toContain('state 1');
  // The spilled file was actually written.
  const cache = ctx.scratch.get('screenshot-trim.spilled') as Map<string, string>;
  const path = [...cache.values()][0];
  expect(path).toBeTruthy();
  expect(existsSync(path)).toBe(true);
});

test('no-op at or below the keep count', async () => {
  const ctx = freshCtx();
  expect(await run(ctx, 2, [shot(1), shot(2)])).toBeUndefined();
});

test('re-processing reuses the spilled path (no duplicate write)', async () => {
  const ctx = freshCtx();
  const messages = [shot(1), shot(2), shot(3)];
  await run(ctx, 2, messages);
  const cache = ctx.scratch.get('screenshot-trim.spilled') as Map<string, string>;
  const first = new Map(cache);
  await run(ctx, 2, messages);
  expect([...cache.entries()]).toEqual([...first.entries()]);
});
