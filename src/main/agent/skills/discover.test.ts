import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills, parseSkillFrontmatter } from './discover';
import type { SkillRoots } from './types';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'atrium-skills-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Write `<root>/<name>/SKILL.md` with the given frontmatter + body. */
async function makeSkill(
  root: string,
  name: string,
  frontmatter: string,
  body = '',
): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

test('parses minimal frontmatter (name + description)', () => {
  const fm = parseSkillFrontmatter(
    '---\nname: deep-research\ndescription: Research the web\n---\nbody',
  );
  expect(fm).toEqual({ name: 'deep-research', description: 'Research the web' });
});

test('keeps a description that contains a colon', () => {
  const fm = parseSkillFrontmatter('---\nname: x\ndescription: "Use when: do a thing"\n---\n');
  expect(fm?.description).toBe('Use when: do a thing');
});

test('normalizes allowed-tools from a comma string', () => {
  const fm = parseSkillFrontmatter(
    '---\nname: x\ndescription: y\nallowed-tools: read_file, bash ,write_file\n---\n',
  );
  expect(fm?.allowedTools).toEqual(['read_file', 'bash', 'write_file']);
});

test('normalizes allowed-tools from a YAML list', () => {
  const fm = parseSkillFrontmatter(
    '---\nname: x\ndescription: y\nallowed-tools:\n  - read_file\n  - bash\n---\n',
  );
  expect(fm?.allowedTools).toEqual(['read_file', 'bash']);
});

test('rejects missing frontmatter, missing name, missing description, bad yaml', () => {
  expect(parseSkillFrontmatter('no frontmatter here')).toBeNull();
  expect(parseSkillFrontmatter('---\ndescription: y\n---\n')).toBeNull();
  expect(parseSkillFrontmatter('---\nname: x\n---\n')).toBeNull();
  expect(parseSkillFrontmatter('---\nname: : : [\n---\n')).toBeNull();
});

test('discovers skills across roots and sorts by name', async () => {
  const agents = join(tmp, 'agents');
  await makeSkill(agents, 'zeta', 'name: zeta\ndescription: Z');
  await makeSkill(agents, 'alpha', 'name: alpha\ndescription: A');
  const roots: SkillRoots = { agents };

  const skills = await discoverSkills(roots, silent);
  expect(skills.map((s) => s.name)).toEqual(['alpha', 'zeta']);
  expect(skills[0]).toMatchObject({ name: 'alpha', source: 'agents' });
  expect(skills[0].dir).toBe(join(agents, 'alpha'));
});

test('skips malformed skills and missing roots', async () => {
  const claude = join(tmp, 'claude');
  await makeSkill(claude, 'good', 'name: good\ndescription: ok');
  await makeSkill(claude, 'broken', 'description: no name');
  // a directory with no SKILL.md at all
  await mkdir(join(claude, 'empty'), { recursive: true });

  const skills = await discoverSkills({ claude, codex: join(tmp, 'does-not-exist') }, silent);
  expect(skills.map((s) => s.name)).toEqual(['good']);
});

test('same-name collision: higher-priority source wins', async () => {
  const codex = join(tmp, 'codex');
  const agents = join(tmp, 'agents');
  await makeSkill(codex, 'shared', 'name: shared\ndescription: from codex');
  await makeSkill(agents, 'shared', 'name: shared\ndescription: from agents');

  const skills = await discoverSkills({ codex, agents }, silent);
  expect(skills).toHaveLength(1);
  expect(skills[0]).toMatchObject({ source: 'agents', description: 'from agents' });
});

test('skips hidden directories', async () => {
  const agents = join(tmp, 'agents');
  await makeSkill(agents, '.git', 'name: nope\ndescription: should not load');
  await makeSkill(agents, 'real', 'name: real\ndescription: ok');

  const skills = await discoverSkills({ agents }, silent);
  expect(skills.map((s) => s.name)).toEqual(['real']);
});

test('collapses a symlinked duplicate to one entry', async () => {
  const agents = join(tmp, 'agents');
  const claude = join(tmp, 'claude');
  const realDir = await makeSkill(agents, 'tool', 'name: tool\ndescription: real');
  await mkdir(claude, { recursive: true });
  await symlink(realDir, join(claude, 'tool'));

  const skills = await discoverSkills({ agents, claude }, silent);
  expect(skills).toHaveLength(1);
  expect(skills[0].source).toBe('agents');
});
