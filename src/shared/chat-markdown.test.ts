import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { type ChatMarkdownLabels, exportFilename, renderChatMarkdown } from './chat-markdown';

const labels: ChatMarkdownLabels = {
  user: 'User',
  assistant: 'AI',
  tools: (n) => `Used ${n} tool(s)`,
  image: (name) => (name ? `Image: ${name}` : 'Image'),
};

const ui = (role: UIMessage['role'], parts: unknown[], metadata?: unknown): UIMessage =>
  ({ id: 'x', role, parts, metadata }) as unknown as UIMessage;

test('renders user text and assistant prose under role labels', () => {
  const md = renderChatMarkdown({
    title: 'My chat',
    labels,
    messages: [
      ui('user', [{ type: 'text', text: 'hello' }]),
      ui('assistant', [{ type: 'text', text: 'hi **there**' }]),
    ],
  });
  expect(md).toBe('# My chat\n\n## User\n\nhello\n\n## AI\n\nhi **there**\n');
});

test('collapses all tool activity and interleaved narration into one placeholder', () => {
  const md = renderChatMarkdown({
    title: 'T',
    labels,
    messages: [
      ui('assistant', [
        { type: 'reasoning', text: 'thinking hard' },
        { type: 'text', text: 'let me check' },
        {
          type: 'tool-bash',
          toolCallId: '1',
          state: 'output-available',
          input: { cmd: 'ls' },
          output: 'secret output',
        },
        { type: 'text', text: 'now reading the result' },
        { type: 'tool-read', toolCallId: '2', state: 'output-available', input: {}, output: 'x' },
        { type: 'text', text: 'done' },
      ]),
    ],
  });
  expect(md).toContain('## AI\n\n> Used 2 tool(s)\n\ndone');
  expect(md).not.toContain('let me check');
  expect(md).not.toContain('now reading the result');
  expect(md).not.toContain('thinking hard');
  expect(md).not.toContain('secret output');
});

test('images become filename notes and compaction checkpoints are dropped', () => {
  const md = renderChatMarkdown({
    title: 'T',
    labels,
    messages: [
      ui('assistant', [{ type: 'text', text: 'summary of folded work' }], { kind: 'compaction' }),
      ui('user', [
        { type: 'text', text: 'see this' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAAA',
          filename: 'shot.png',
        },
      ]),
    ],
  });
  expect(md).toContain('> Image: shot.png');
  expect(md).not.toContain('data:image/png');
  expect(md).not.toContain('summary of folded work');
});

test('exportFilename strips unsafe characters and falls back', () => {
  expect(exportFilename('fix: a/b bug?')).toBe('fix a b bug');
  expect(exportFilename('///')).toBe('conversation');
  expect(exportFilename('.hidden')).toBe('hidden');
});
