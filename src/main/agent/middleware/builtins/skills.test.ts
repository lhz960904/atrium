import { expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import type { Skill } from '../../skills/types';
import type { RunContext } from '../types';
import { skillsMiddleware } from './skills';

const skill = (over: Partial<Skill>): Skill => ({
  name: 'deep-research',
  description: 'Research the web and cite sources',
  dir: '/home/u/.agents/skills/deep-research',
  source: 'agents',
  ...over,
});

function ctxWith(messages: UIMessage[]): RunContext {
  return { request: { messages, system: '', tools: {} } } as unknown as RunContext;
}

const userMsg = (text: string): UIMessage => ({
  id: 'u1',
  role: 'user',
  parts: [{ type: 'text', text }],
});

test('prepends the skill index to the first user message', () => {
  const ctx = ctxWith([userMsg('hello')]);
  skillsMiddleware({ skills: [skill({})] }).beforeRun?.(ctx);

  const parts = ctx.request.messages[0].parts;
  expect(parts).toHaveLength(2);
  const first = parts[0] as { type: string; text: string };
  expect(first.type).toBe('text');
  expect(first.text).toContain('<available_skills>');
  expect(first.text).toContain('<skill name="deep-research">');
  expect(first.text).toContain('Research the web and cite sources');
  // the on-disk path is deliberately withheld (don't invite a direct read)
  expect(first.text).not.toContain('/home/u/.agents/skills/deep-research');
  expect(first.text).not.toContain('SKILL.md');
  // the user's own text stays after the injected index
  expect((parts[1] as { text: string }).text).toBe('hello');
});

test('no skills → leaves messages untouched', () => {
  const original = [userMsg('hello')];
  const ctx = ctxWith(original);
  skillsMiddleware({ skills: [] }).beforeRun?.(ctx);
  expect(ctx.request.messages).toBe(original);
});

test('injects non-destructively — original message object is not mutated', () => {
  const original = userMsg('hello');
  const ctx = ctxWith([original]);
  skillsMiddleware({ skills: [skill({})] }).beforeRun?.(ctx);

  expect(original.parts).toHaveLength(1);
  expect(ctx.request.messages[0]).not.toBe(original);
});

test('targets the first user message when assistant turns precede it', () => {
  const assistant: UIMessage = {
    id: 'a0',
    role: 'assistant',
    parts: [{ type: 'text', text: 'hi' }],
  };
  const ctx = ctxWith([assistant, userMsg('question')]);
  skillsMiddleware({ skills: [skill({})] }).beforeRun?.(ctx);

  expect(ctx.request.messages[0]).toBe(assistant);
  expect(ctx.request.messages[1].parts).toHaveLength(2);
  expect((ctx.request.messages[1].parts[0] as { text: string }).text).toContain(
    '<available_skills>',
  );
});

test('escapes XML metacharacters in name/description', () => {
  const ctx = ctxWith([userMsg('hi')]);
  skillsMiddleware({ skills: [skill({ description: 'use <b> & "co" when a < b' })] }).beforeRun?.(
    ctx,
  );
  const text = (ctx.request.messages[0].parts[0] as { text: string }).text;
  expect(text).toContain('use &lt;b&gt; &amp; "co" when a &lt; b');
  expect(text).not.toContain('<b>');
});

test('lists every discovered skill', () => {
  const ctx = ctxWith([userMsg('hi')]);
  skillsMiddleware({
    skills: [skill({ name: 'alpha' }), skill({ name: 'beta' }), skill({ name: 'gamma' })],
  }).beforeRun?.(ctx);
  const text = (ctx.request.messages[0].parts[0] as { text: string }).text;
  for (const n of ['alpha', 'beta', 'gamma']) expect(text).toContain(`<skill name="${n}">`);
});

import { SKILL_SCRATCH_KEY } from '../../skills/types';

function scopingCtx(scratch: Map<string, unknown>): RunContext {
  const tools = Object.fromEntries(
    ['read_file', 'write_file', 'bash', 'web_search', 'task', 'skill'].map((n) => [n, {}]),
  );
  return { request: { messages: [], system: '', tools }, scratch } as unknown as RunContext;
}

test('beforeStep: no active skill → no tool scoping', () => {
  const out = skillsMiddleware({ skills: [] }).beforeStep?.(scopingCtx(new Map()), {
    stepNumber: 1,
    messages: [],
  });
  expect(out).toBeUndefined();
});

test('beforeStep: active skill scopes activeTools to its (mapped) allowed-tools', () => {
  const scratch = new Map<string, unknown>([
    [SKILL_SCRATCH_KEY, { name: 'pptx', allowedTools: ['Read', 'bash'] }],
  ]);
  const out = skillsMiddleware({ skills: [] }).beforeStep?.(scopingCtx(scratch), {
    stepNumber: 2,
    messages: [],
  });
  expect(out).toEqual({ activeTools: ['read_file', 'bash'] });
});

test('beforeStep: an unconstrainable allow-list leaves tools open (no ban-all)', () => {
  const scratch = new Map<string, unknown>([
    [SKILL_SCRATCH_KEY, { name: 'x', allowedTools: ['Glob', 'mcp__y'] }],
  ]);
  const out = skillsMiddleware({ skills: [] }).beforeStep?.(scopingCtx(scratch), {
    stepNumber: 2,
    messages: [],
  });
  expect(out).toBeUndefined();
});

test('beforeStep: active skill without allowed-tools imposes no scope', () => {
  const scratch = new Map<string, unknown>([[SKILL_SCRATCH_KEY, { name: 'x' }]]);
  const out = skillsMiddleware({ skills: [] }).beforeStep?.(scopingCtx(scratch), {
    stepNumber: 2,
    messages: [],
  });
  expect(out).toBeUndefined();
});
