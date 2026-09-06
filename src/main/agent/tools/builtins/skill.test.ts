import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@shared/protocol';
import type { RunContext } from '../../run-context';
import { type ActiveSkill, SKILL_SCRATCH_KEY, type Skill } from '../../skills/types';
import { runTool } from '../testing';
import { latestSkillBody, preserveActiveSkill, skillTool } from './skill';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'atrium-skilltool-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeSkill(
  name: string,
  frontmatter: string,
  body: string,
  allowedTools?: string[],
): Promise<Skill> {
  const dir = join(tmp, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return { name, description: 'x', dir, source: 'agents', ...(allowedTools && { allowedTools }) };
}

function fakeCtx(): RunContext {
  return {
    threadId: 'thread-123',
    scratch: new Map<string, unknown>(),
    emit: () => {},
  } as unknown as RunContext;
}

const load = (skills: Skill[], run: RunContext, input: { name: string; args?: string }) =>
  runTool(skillTool({ skills, run }), input);

test('prepends the base directory, strips frontmatter, substitutes SKILL_DIR', async () => {
  const skill = await writeSkill(
    'deep-research',
    'name: deep-research\ndescription: research',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholders the tool substitutes
    'Run ${SKILL_DIR}/run.py and $SKILL_DIR/extra.py.',
  );
  const ctx = fakeCtx();
  const out = await load([skill], ctx, { name: 'deep-research' });

  expect(out).toContain(`Base directory for this skill: ${skill.dir}`);
  // both ${SKILL_DIR} and $SKILL_DIR spellings resolved to the absolute dir
  expect(out).toContain(`Run ${skill.dir}/run.py and ${skill.dir}/extra.py.`);
  expect(out).not.toContain('name: deep-research');
});

test('records the active skill in scratch (name + allowed-tools)', async () => {
  const skill = await writeSkill(
    'pptx',
    'name: pptx\ndescription: slides\nallowed-tools: read_file, bash',
    'body',
    ['read_file', 'bash'],
  );
  const ctx = fakeCtx();
  await load([skill], ctx, { name: 'pptx' });

  expect(ctx.scratch.get(SKILL_SCRATCH_KEY)).toEqual({
    name: 'pptx',
    allowedTools: ['read_file', 'bash'],
  } satisfies ActiveSkill);
});

test('appends user-supplied args after the body', async () => {
  const skill = await writeSkill('x', 'name: x\ndescription: y', 'do the thing');
  const ctx = fakeCtx();
  const out = await load([skill], ctx, { name: 'x', args: 'on the Q3 report' });
  expect(out).toContain('do the thing');
  expect(out).toContain('Arguments for this run: on the Q3 report');
});

test('an unknown skill fails, listing the available ones', async () => {
  const skill = await writeSkill('real', 'name: real\ndescription: y', 'body');
  const ctx = fakeCtx();
  expect(load([skill], ctx, { name: 'ghost' })).rejects.toThrow(/unknown skill 'ghost'.*real/);
  // nothing activated on failure
  expect(ctx.scratch.get(SKILL_SCRATCH_KEY)).toBeUndefined();
});

test('a missing manifest file fails with a read error', async () => {
  const skill: Skill = {
    name: 'gone',
    description: 'y',
    dir: join(tmp, 'gone'), // never created
    source: 'agents',
  };
  expect(load([skill], fakeCtx(), { name: 'gone' })).rejects.toThrow("could not read skill 'gone'");
});

const skillResult = (text: string): Message =>
  ({
    role: 'toolResult',
    toolCallId: '1',
    toolName: 'skill',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 0,
  }) as Message;

test('latestSkillBody returns the most recent loaded body', () => {
  expect(latestSkillBody([skillResult('first'), skillResult('second')])).toBe('second');
  expect(latestSkillBody([{ role: 'user', content: 'hi', timestamp: 0 }])).toBeNull();
});

test('the body is carried only when it is being folded away', () => {
  // loaded body sits in the fold, not the kept window → carry it
  const carried = preserveActiveSkill([skillResult('SOP')], []);
  expect(carried).toContain('Active skill instructions');
  expect(carried).toContain('SOP');

  // already in the kept window → nothing to carry
  expect(preserveActiveSkill([skillResult('SOP')], [skillResult('SOP')])).toBeNull();
  // no skill anywhere → nothing to carry
  expect(preserveActiveSkill([], [])).toBeNull();
});
