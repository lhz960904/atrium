import { expect, test } from 'bun:test';
import { buildSystemPrompt, currentDateNote, workspaceGuidance } from './system';

test('opens with the broad Atrium identity, not a coding-only or Mac-bound one', () => {
  const p = buildSystemPrompt('/tmp/ws');
  expect(p.startsWith('You are Atrium')).toBe(true);
  expect(p).not.toContain('Mac.');
  expect(p).not.toMatch(/coding agent/i);
});

test('embeds the workspace root and the shared paths rule', () => {
  const p = buildSystemPrompt('/home/me/project');
  expect(p).toContain('/home/me/project');
  expect(p).toContain(workspaceGuidance('/home/me/project'));
});

test('maps the platform to a friendly label when provided, omits it otherwise', () => {
  expect(buildSystemPrompt('/tmp/ws', { platform: 'darwin' })).toContain('running on macOS');
  expect(buildSystemPrompt('/tmp/ws', { platform: 'win32' })).toContain('running on Windows');
  expect(buildSystemPrompt('/tmp/ws')).not.toContain('running on');
});

test('states how approvals behave under the active permission mode, or stays silent without one', () => {
  expect(buildSystemPrompt('/tmp/ws', { mode: 'full-access' })).toContain('full-access mode');
  const review = buildSystemPrompt('/tmp/ws', { mode: 'auto-review' });
  expect(review).toContain('auto-review mode');
  expect(review).toContain('reviewer');
  const none = buildSystemPrompt('/tmp/ws');
  expect(none).not.toContain('full-access');
  expect(none).not.toContain('auto-review');
  expect(none).not.toContain('default mode');
});

test('injects the soul with a precedence note over the style guidance', () => {
  const p = buildSystemPrompt('/tmp/ws', { soul: 'You are 小Q. Reply in 简体中文.' });
  expect(p).toContain('<soul>\nYou are 小Q. Reply in 简体中文.\n</soul>');
  expect(p).toContain('takes precedence');
  // No empty soul tags when absent.
  expect(buildSystemPrompt('/tmp/ws')).not.toContain('<soul>');
});

test('the date is not baked into the system prompt (it rides a per-turn reminder instead)', () => {
  expect(buildSystemPrompt('/tmp/ws')).not.toContain("Today's date is");
});

test('currentDateNote renders a date+time anchor and tells the model to prefer now', () => {
  const note = currentDateNote(new Date('2026-06-15T12:00:00Z'));
  // Time varies by the test machine's zone, so assert the shape, not a value.
  expect(note).toMatch(/The current date and time is \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(\w+, .+\)\./);
  // Noon UTC reads as 2026 in every time zone, so the year is assertable cross-machine.
  expect(note).toContain('2026');
  expect(note).toMatch(/training cutoff/i);
});

test('does not re-explain individual tools (their descriptions own that)', () => {
  const p = buildSystemPrompt('/tmp/ws');
  // Guards against the old per-tool paragraphs creeping back in.
  expect(p).not.toContain('edit_file');
  expect(p).not.toContain('run_in_background');
  expect(p).not.toContain('image_gen');
});

test('tells the model to cite web sources as titled markdown links, not bare URLs', () => {
  const p = buildSystemPrompt('/tmp/ws');
  expect(p).toContain('[title](url)');
});

test('carries the durable scaffold sections', () => {
  const p = buildSystemPrompt('/tmp/ws');
  for (const heading of [
    '# Communication',
    '# Working in a codebase',
    '# Getting work done',
    '# Version control and safety',
  ]) {
    expect(p).toContain(heading);
  }
});
