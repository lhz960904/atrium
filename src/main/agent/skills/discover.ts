import { readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createLogger } from '../../log';
import {
  SKILL_FILE,
  type Skill,
  type SkillRoots,
  type SkillSource,
  SOURCE_PRIORITY,
} from './types';

const log = createLogger('skills');

/** Parsed frontmatter, before it becomes a Skill (no dir/source yet). */
export type SkillFrontmatter = {
  name: string;
  description: string;
  allowedTools?: string[];
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse a SKILL.md's leading YAML frontmatter. Returns null when there's no
 * frontmatter block, when it isn't valid YAML, or when the required name /
 * description are missing — a malformed skill is skipped, never half-loaded.
 *
 * allowed-tools accepts both a YAML list and a comma-separated string (Claude
 * Code authors it as a string); either normalizes to a trimmed string array.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;

  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const rec = data as Record<string, unknown>;
  const name = rec.name;
  const description = rec.description;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof description !== 'string' || !description.trim()) return null;

  const allowedTools = normalizeAllowedTools(rec['allowed-tools']);
  return {
    name: name.trim(),
    description: description.trim(),
    ...(allowedTools && { allowedTools }),
  };
}

/** Strip the leading YAML frontmatter block, returning just the skill body. */
export function stripFrontmatter(content: string): string {
  return content
    .replace(FRONTMATTER_RE, '')
    .replace(/^\s*\n/, '')
    .trimEnd();
}

function normalizeAllowedTools(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : undefined;
  if (!list) return undefined;
  const tools = list.map((t) => String(t).trim()).filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

/** Read + parse one `<dir>/SKILL.md` into a Skill, or null if absent/malformed. */
async function loadSkill(dir: string, source: SkillSource): Promise<Skill | null> {
  let content: string;
  try {
    content = await readFile(join(dir, SKILL_FILE), 'utf8');
  } catch {
    return null;
  }
  const fm = parseSkillFrontmatter(content);
  if (!fm) return null;
  return { ...fm, dir, source };
}

/** Scan one root for `<name>/SKILL.md` subdirectories. Missing root → []. */
async function scanRoot(root: string, source: SkillSource): Promise<Skill[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = await Promise.all(
    entries
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => loadSkill(join(root, e.name), source)),
  );
  const loaded = skills.filter((s): s is Skill => s !== null);
  if (loaded.length > 0) log.info(`discovered ${loaded.length} skill(s) in ${root}`);
  return loaded;
}

/**
 * Discover skills across the configured roots. Each root contributes its
 * `<name>/SKILL.md` entries; collisions are resolved twice over:
 *
 *  - by canonical path (realpath), so a directory reachable through two roots
 *    (e.g. one root symlinked into another) is counted once, and
 *  - by skill name, where the higher-priority source wins (SOURCE_PRIORITY) —
 *    the shared ~/.agents home overriding an ecosystem copy of the same name.
 *
 * Pure over its roots + filesystem (no AI SDK); the only side channel is the
 * scoped logger, which falls back to console off Electron — directly unit
 * testable against a temp dir.
 */
export async function discoverSkills(roots: SkillRoots): Promise<Skill[]> {
  const all: Skill[] = [];
  for (const [source, root] of Object.entries(roots) as [SkillSource, string][]) {
    if (root) all.push(...(await scanRoot(root, source)));
  }

  // Collapse symlinked duplicates first: same physical dir → keep one (priority).
  const byPath = new Map<string, Skill>();
  for (const skill of all) {
    let canonical: string;
    try {
      canonical = await realpath(skill.dir);
    } catch {
      canonical = skill.dir;
    }
    const prev = byPath.get(canonical);
    if (!prev || SOURCE_PRIORITY[skill.source] > SOURCE_PRIORITY[prev.source]) {
      byPath.set(canonical, skill);
    }
  }

  // Then collapse same-name skills from genuinely different locations.
  const byName = new Map<string, Skill>();
  for (const skill of byPath.values()) {
    const prev = byName.get(skill.name);
    if (!prev || SOURCE_PRIORITY[skill.source] > SOURCE_PRIORITY[prev.source]) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
