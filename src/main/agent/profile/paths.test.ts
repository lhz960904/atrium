import { expect, test } from 'bun:test';
import { parseDisplayName } from './paths';

test('parseDisplayName reads the frontmatter name', () => {
  expect(parseDisplayName('---\nname: 昊泽\n---\nbackground here')).toBe('昊泽');
});

test('parseDisplayName returns null without a name', () => {
  expect(parseDisplayName('no frontmatter')).toBeNull();
  expect(parseDisplayName('---\nrole: dev\n---')).toBeNull();
  expect(parseDisplayName('---\nname: "   "\n---')).toBeNull();
});
