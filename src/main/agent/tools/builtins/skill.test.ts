import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunContext } from '../../middleware';
import { type ActiveSkill, SKILL_SCRATCH_KEY, type Skill } from '../../skills/types';
import { latestSkillBodyModel, latestSkillBodyUI, skillPreserver, skillTool } from './skill';

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

const run = (
  skill: ReturnType<typeof skillTool>,
  input: { name: string; args?: string },
  ctx: RunContext,
): Promise<string> =>
  // biome-ignore lint/suspicious/noExplicitAny: tool.execute's options arg is loose in tests
  skill.execute?.(input, { experimental_context: ctx } as any) as Promise<string>;

test('prepends the base directory, strips frontmatter, substitutes SKILL_DIR', async () => {
  const skill = await writeSkill(
    'deep-research',
    'name: deep-research\ndescription: research',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholders the tool substitutes
    'Run ${SKILL_DIR}/run.py and $SKILL_DIR/extra.py.',
  );
  const ctx = fakeCtx();
  const out = await run(skillTool({ skills: [skill] }), { name: 'deep-research' }, ctx);

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
  await run(skillTool({ skills: [skill] }), { name: 'pptx' }, ctx);

  expect(ctx.scratch.get(SKILL_SCRATCH_KEY)).toEqual({
    name: 'pptx',
    allowedTools: ['read_file', 'bash'],
  } satisfies ActiveSkill);
});

test('appends user-supplied args after the body', async () => {
  const skill = await writeSkill('x', 'name: x\ndescription: y', 'do the thing');
  const ctx = fakeCtx();
  const out = await run(
    skillTool({ skills: [skill] }),
    { name: 'x', args: 'on the Q3 report' },
    ctx,
  );
  expect(out).toContain('do the thing');
  expect(out).toContain('Arguments for this run: on the Q3 report');
});

test('unknown skill returns an error listing the available ones', async () => {
  const skill = await writeSkill('real', 'name: real\ndescription: y', 'body');
  const ctx = fakeCtx();
  const out = await run(skillTool({ skills: [skill] }), { name: 'ghost' }, ctx);
  expect(out).toContain("unknown skill 'ghost'");
  expect(out).toContain('real');
  // nothing activated on failure
  expect(ctx.scratch.get(SKILL_SCRATCH_KEY)).toBeUndefined();
});

test('a missing manifest file returns a read error, not a throw', async () => {
  const skill: Skill = {
    name: 'gone',
    description: 'y',
    dir: join(tmp, 'gone'), // never created
    source: 'agents',
  };
  const ctx = fakeCtx();
  const out = await run(skillTool({ skills: [skill] }), { name: 'gone' }, ctx);
  expect(out).toContain("could not read skill 'gone'");
});

// biome-ignore lint/suspicious/noExplicitAny: terse message fixtures for the preserver
const uiSkill = (output: string): any => ({
  parts: [{ type: 'tool-skill', state: 'output-available', output }],
});
// biome-ignore lint/suspicious/noExplicitAny: terse message fixtures for the preserver
const modelSkillResult = (output: unknown): any => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolName: 'skill', output }],
});

test('latestSkillBodyUI returns the most recent loaded body', () => {
  expect(latestSkillBodyUI([uiSkill('first'), uiSkill('second')])).toBe('second');
  expect(latestSkillBodyUI([{ parts: [] } as never])).toBeNull();
});

test('latestSkillBodyModel reads text and string tool-result outputs', () => {
  expect(latestSkillBodyModel([modelSkillResult('plain')])).toBe('plain');
  expect(latestSkillBodyModel([modelSkillResult({ type: 'text', value: 'wrapped' })])).toBe(
    'wrapped',
  );
});

test('preserver carries the body only when it is being folded away', () => {
  // loaded body sits in the fold, not the kept window → carry it
  const carried = skillPreserver.fromUI([uiSkill('SOP')], []);
  expect(carried).toContain('Active skill instructions');
  expect(carried).toContain('SOP');

  // already in the kept window → nothing to carry
  expect(skillPreserver.fromUI([uiSkill('SOP')], [uiSkill('SOP')])).toBeNull();
  // no skill anywhere → nothing to carry
  expect(skillPreserver.fromUI([], [])).toBeNull();
});

test('preserver works on the within-turn (ModelMessage) fold', () => {
  const carried = skillPreserver.fromModel([modelSkillResult('SOP')], []);
  expect(carried).toContain('SOP');
  expect(skillPreserver.fromModel([modelSkillResult('SOP')], [modelSkillResult('SOP')])).toBeNull();
});
