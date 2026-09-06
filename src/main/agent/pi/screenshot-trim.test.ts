import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { screenshotTrim } from './screenshot-trim';

const MEDIA = join('.atrium', 'media');

const workspace = () => mkdtempSync(join(tmpdir(), 'shot-trim-'));

/** A computer-tool result: state text (AX tree) plus a screenshot. */
const shot = (n: number): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId: `c${n}`,
    toolName: 'computer_get_app_state',
    content: [
      { type: 'text', text: `state ${n}` },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ],
    details: { screenshot: 'kept for the card' },
    isError: false,
    timestamp: n,
  }) as AgentMessage;

const imageCount = (messages: AgentMessage[]): number =>
  messages
    .filter((m) => m.role === 'toolResult')
    .flatMap((m) => m.content)
    .filter((c) => c.type === 'image').length;

test('keeps last N screenshots; older ones spill to a view_image note', async () => {
  const root = workspace();
  const messages: AgentMessage[] = [
    { role: 'user', content: 'do it', timestamp: 0 },
    shot(1),
    shot(2),
    shot(3),
    shot(4),
  ];
  const trimmed = await screenshotTrim(root, 2)(messages);

  expect(imageCount(trimmed)).toBe(2);
  const dump = JSON.stringify(trimmed);
  expect(dump).toContain('view_image');
  expect(dump).toContain(MEDIA);
  // Recent images kept, and the text state preserved for the trimmed steps too.
  for (const n of [1, 2, 3, 4]) expect(dump).toContain(`state ${n}`);
  // The card's payload is untouched — this rewrites only what the model sees.
  expect(dump).toContain('kept for the card');

  const written = await readdir(join(root, MEDIA));
  expect(written).toHaveLength(2);
  expect(existsSync(join(root, MEDIA, written[0]))).toBe(true);
});

test('no-op at or below the keep count', async () => {
  const messages = [shot(1), shot(2)];
  expect(await screenshotTrim(workspace(), 2)(messages)).toBe(messages);
});

test('a later request reuses the spilled path instead of writing the file again', async () => {
  const root = workspace();
  const trim = screenshotTrim(root, 2);
  const messages = [shot(1), shot(2), shot(3)];
  const first = await trim(messages);
  const second = await trim(messages);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  expect(await readdir(join(root, MEDIA))).toHaveLength(1);
});
