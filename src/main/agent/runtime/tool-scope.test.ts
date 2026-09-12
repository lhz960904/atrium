import { expect, test } from 'bun:test';
import type { AtriumTool } from '../tools';
import { scopeToolsToSkill } from './tool-scope';

const tools = ['read_file', 'write_file', 'bash', 'web_search', 'skill'].map(
  (name) => ({ name }) as AtriumTool,
);
const names = (out: AtriumTool[]) => out.map((t) => t.name);

test('no active skill leaves every tool offered', () => {
  expect(scopeToolsToSkill(tools, undefined)).toBe(tools);
});

test('an active skill narrows to its (mapped) allow-list', () => {
  const out = scopeToolsToSkill(tools, { name: 'pptx', allowedTools: ['Read', 'bash'] });
  expect(names(out)).toEqual(['read_file', 'bash']);
});

test('an unconstrainable allow-list leaves tools open, never bans them all', () => {
  const out = scopeToolsToSkill(tools, { name: 'x', allowedTools: ['Glob', 'mcp__y'] });
  expect(names(out)).toEqual(names(tools));
});

test('an active skill without an allow-list imposes no scope', () => {
  expect(names(scopeToolsToSkill(tools, { name: 'x' }))).toEqual(names(tools));
});

test('scoping never compounds — it is always taken from the full set', () => {
  const once = scopeToolsToSkill(tools, { name: 'x', allowedTools: ['Read', 'bash'] });
  const twice = scopeToolsToSkill(tools, { name: 'y', allowedTools: ['bash', 'web_search'] });
  expect(names(once)).toEqual(['read_file', 'bash']);
  expect(names(twice)).toEqual(['bash', 'web_search']);
});
