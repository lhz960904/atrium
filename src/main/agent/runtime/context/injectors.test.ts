import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Skill } from '../../skills/types';
import {
  injectContextBlocks,
  instructionsBlock,
  loadContextBlocks,
  memoryBlock,
  profileBlock,
  skillsIndexBlock,
} from './injectors';

const skill = (over: Partial<Skill> = {}): Skill => ({
  name: 'deep-research',
  description: 'Research the web and cite sources',
  dir: '/home/u/.agents/skills/deep-research',
  source: 'agents',
  ...over,
});

const user = (text: string): AgentMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: 0,
});

const textsOf = (message: AgentMessage): string[] => {
  const content = 'content' in message ? message.content : [];
  return (content as { type: string; text: string }[]).flatMap((c) =>
    c.type === 'text' ? [c.text] : [],
  );
};

test('the skills index lists every skill by name and description, never its path', () => {
  const block = skillsIndexBlock([skill(), skill({ name: 'kami', description: 'Typeset' })]);
  expect(block).toContain('<skill name="deep-research">');
  expect(block).toContain('Research the web and cite sources');
  expect(block).toContain('<skill name="kami">');
  expect(block).not.toContain('/home/u/.agents/skills/deep-research');
  expect(block).not.toContain('SKILL.md');
});

test('the skills index escapes XML metacharacters', () => {
  const block = skillsIndexBlock([skill({ description: 'use <b> & "co" when a < b' })]);
  expect(block).toContain('use &lt;b&gt; &amp; "co" when a &lt; b');
  expect(block).not.toContain('<b>');
});

test('no skills, no instructions, no profile → no block', () => {
  expect(skillsIndexBlock([])).toBeNull();
  expect(instructionsBlock([])).toBeNull();
  expect(profileBlock('')).toBeNull();
});

test('a header-only memory index injects nothing', () => {
  expect(memoryBlock('global', '# Memory\n')).toBeNull();
  expect(memoryBlock('global', '# Memory\n\n- [a](a.md) — hook\n')).toContain('scope="global"');
});

async function fixtures() {
  const root = await mkdtemp(join(tmpdir(), 'ctx-blocks-'));
  const home = join(root, 'home');
  const ws = join(root, 'ws');
  const mem = join(root, 'mem');
  await mkdir(join(mem, 'global'), { recursive: true });
  await mkdir(join(mem, 'project'), { recursive: true });
  await mkdir(ws, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(mem, 'global', 'MEMORY.md'), '# Memory\n\n- [a](a.md) — global one\n');
  await writeFile(join(mem, 'project', 'MEMORY.md'), '# Memory\n\n- [b](b.md) — project one\n');
  await writeFile(join(ws, 'AGENTS.md'), 'workspace rule');
  return {
    skills: [skill()],
    workspaceRoot: ws,
    home,
    resolveMemoryDir: (scope: 'global' | 'project') => join(mem, scope),
    readUser: async () => 'name: Haoze',
  };
}

/**
 * The order the model reads them in is the contract: the profile on top, the
 * skills index closest to what the user actually wrote. Pinned because each
 * block is prepended, so adding one silently reshuffles the rest.
 */
test('injects the standing blocks onto the first user turn, profile first', async () => {
  const blocks = await loadContextBlocks(await fixtures());
  const [message] = await injectContextBlocks(blocks)([user('hello')]);
  const view = textsOf(message).join('\n');
  const at = [
    '<user-profile>',
    '<custom-instructions>',
    '<memory scope="global">',
    '<memory scope="project">',
    '<available_skills>',
    'hello',
  ].map((marker) => view.indexOf(marker));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});

test('targets the first user turn even when an assistant message precedes it', async () => {
  const blocks = await loadContextBlocks(await fixtures());
  const assistant = { role: 'assistant', content: [] } as unknown as AgentMessage;
  const out = await injectContextBlocks(blocks)([assistant, user('question')]);
  expect(out[0]).toBe(assistant);
  expect(textsOf(out[1]).at(-1)).toBe('question');
});

test('leaves the stored message untouched — the injection is view-only', async () => {
  const blocks = await loadContextBlocks(await fixtures());
  const original = user('hello');
  const out = await injectContextBlocks(blocks)([original]);
  expect(textsOf(original)).toEqual(['hello']);
  expect(out[0]).not.toBe(original);
});

test('an unreachable memory store degrades to no memory block', async () => {
  const f = await fixtures();
  const blocks = await loadContextBlocks({
    ...f,
    resolveMemoryDir: () => {
      throw new Error('no electron');
    },
  });
  expect(blocks.some((b) => b.startsWith('<memory'))).toBe(false);
  expect(blocks.some((b) => b.startsWith('<user-profile>'))).toBe(true);
});
