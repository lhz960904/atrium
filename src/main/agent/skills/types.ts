/**
 * A discovered skill: a directory-style `<name>/SKILL.md` whose frontmatter the
 * model sees in an index, and whose body is loaded on demand (progressive
 * loading). The index carries only name + description + location; `dir` anchors
 * `${SKILL_DIR}` for the skill's bundled scripts/templates.
 */
export type Skill = {
  name: string;
  description: string;
  /**
   * Declared tool allow-list, kept as raw strings rather than our ToolName.
   * Skills from foreign ecosystems (~/.claude, ~/.codex) name tools in their own
   * vocabulary (Read, Bash…), not ours (read_file, bash). Discovery records the
   * declaration faithfully; the scoping pass intersects it against our actual
   * tool registry, so foreign names simply don't constrain.
   */
  allowedTools?: string[];
  /** Absolute skill directory; anchors `${SKILL_DIR}` and holds SKILL.md. */
  dir: string;
  source: SkillSource;
};

/** The skill manifest filename — fixed by the directory-style convention. */
export const SKILL_FILE = 'SKILL.md';

/**
 * Where a skill came from. `agents` is the tool-neutral shared home
 * (~/.agents/skills) — Atrium's own skills live there so other tools can read
 * them too. `claude`/`codex` consume those ecosystems' skills in place.
 */
export type SkillSource = 'builtin' | 'agents' | 'claude' | 'codex';

/** Absolute scan root per source; a source is skipped when absent. */
export type SkillRoots = Partial<Record<SkillSource, string>>;

/**
 * Same-name collision winner, low→high. The shared home outranks the others so
 * a skill we author there overrides an ecosystem copy of the same name; built-in
 * is the floor, overridable by anything on disk.
 */
export const SOURCE_PRIORITY: Record<SkillSource, number> = {
  builtin: 0,
  codex: 1,
  claude: 2,
  agents: 3,
};
