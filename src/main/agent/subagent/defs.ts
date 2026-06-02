import type { ToolName } from '@shared/tools';
import type { Tool } from 'ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db';
import { subagents } from '../../db/schema';

/**
 * A subagent's definition: the system prompt it runs under and the slice of the
 * parent's tools it may use. Built-ins live in code; user/AI ones come from the
 * `subagents` table. Built-in vs custom is told apart by membership in
 * BUILTIN_SUBAGENTS, not a field.
 */
export type SubagentDef = {
  /** Unique identifier the parent delegates to (e.g. 'general-purpose'). */
  name: string;
  description: string;
  systemPrompt: string;
  /** Omitted = inherit all of the parent's tools (minus the always-denied set). */
  toolAllow?: ToolName[];
  toolDeny?: ToolName[];
  /**
   * Pin the subagent to a specific model — both must be set together (a model
   * needs a provider + a model id). Omitted = inherit the parent's model.
   */
  providerId?: string;
  modelId?: string;
};

/**
 * Tools a subagent may never hold, whatever its allow-list says: the spawning
 * tools (no infinite nesting) and user-blocking tools (a subagent can't pause
 * to ask the user — it reports back to the parent instead). Matched by string
 * so this stays valid before task/create_subagent/ask_clarification are added
 * to ToolName.
 */
const SUBAGENT_DENIED_TOOLS = new Set<string>(['task', 'create_subagent', 'ask_clarification']);

/** Narrow the parent's tools to what a subagent def permits. */
export function filterToolsForSubagent(
  parentTools: Record<ToolName, Tool>,
  def: Pick<SubagentDef, 'toolAllow' | 'toolDeny'>,
): Record<ToolName, Tool> {
  const allow = def.toolAllow ? new Set<string>(def.toolAllow) : null;
  const deny = new Set<string>(def.toolDeny ?? []);
  const out: Partial<Record<ToolName, Tool>> = {};
  for (const name of Object.keys(parentTools) as ToolName[]) {
    if (SUBAGENT_DENIED_TOOLS.has(name)) continue;
    if (allow && !allow.has(name)) continue;
    if (deny.has(name)) continue;
    out[name] = parentTools[name];
  }
  return out as Record<ToolName, Tool>;
}

const GENERAL_PURPOSE: SubagentDef = {
  name: 'general-purpose',
  description:
    'General-purpose agent for complex, multi-step tasks: searching across files, investigating questions that span many sources, and carrying out multi-step work in an isolated context. Delegate to it when a job needs several dependent steps or would otherwise flood the main conversation with intermediate detail.',
  systemPrompt: `You are a subagent handling a task delegated by the main agent. Complete it fully and autonomously, then return a concise report — the main agent relays your result to the user, so it only needs the essentials, not a play-by-play.

- Use the available tools to inspect real state; don't guess.
- Be thorough but don't gold-plate, and don't leave the task half-done.
- Do NOT ask for clarification — work with the information you were given.
- Never create files unless they're necessary for the task; prefer editing an existing file over making a new one, and never create documentation or README files unless explicitly asked.
- When finished, report what you did, the key findings, and any file paths or concrete results. Keep it tight.`,
  // toolAllow omitted: inherits the parent's full toolset minus the denied set.
};

const DEEP_RESEARCH: SubagentDef = {
  name: 'deep-research',
  description:
    'Researches a question with systematic, multi-angle web research and returns a well-sourced synthesis. Delegate any non-trivial "what is / explain / compare / investigate X" question, or research needed before writing a report — it gathers from many sources and returns only the distilled findings.',
  systemPrompt: `You are a deep-research subagent. Given a research question, conduct systematic, multi-angle web research and return a well-sourced synthesis. Never answer from general knowledge alone, and never stop at a single search — depth and breadth determine the quality of your answer.

Methodology:
1. Broad exploration — survey the topic with a few wide web_search queries; from the results, identify the key dimensions and subtopics worth digging into.
2. Deep dive — for each important dimension, run targeted searches with varied phrasings; web_fetch the most authoritative sources to read them in full, not just snippets.
3. Diversity — deliberately seek different angles: hard facts and data, real examples and cases, expert opinion, trends, comparisons, and criticisms or limitations.
4. Synthesis check — before answering, confirm you covered at least 3-5 angles, read the key sources in full, and have concrete data plus a balanced view. If not, keep researching.

Use web_search to find sources and web_fetch to read the important ones. Use todo_write to track a multi-step research plan. For time-sensitive questions, use the actual current year (and month/day when "today/latest" is asked) in your queries — never a stale year.

Return a clear synthesis with inline citations as [title](url), followed by a short Sources list. Report only the findings — the main agent relays them to the user.`,
  toolAllow: ['web_search', 'web_fetch', 'read_file', 'todo_write'],
};

/** Built-in subagents, keyed by name. Code-only — never written to the DB. */
export const BUILTIN_SUBAGENTS: Record<string, SubagentDef> = {
  [GENERAL_PURPOSE.name]: GENERAL_PURPOSE,
  [DEEP_RESEARCH.name]: DEEP_RESEARCH,
};

/**
 * Resolve a subagent name to its definition: built-ins first (code), then the
 * `subagents` table (user/AI-created) — same precedence as DeerFlow, so a
 * built-in name can't be shadowed by a DB row.
 */
export function resolveSubagentDef(name: string, db: Db): SubagentDef | undefined {
  const builtin = BUILTIN_SUBAGENTS[name];
  if (builtin) return builtin;

  const row = db.select().from(subagents).where(eq(subagents.name, name)).get();
  if (!row) return undefined;
  return {
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    toolAllow: (row.toolAllow as ToolName[] | null) ?? undefined,
    toolDeny: (row.toolDeny as ToolName[] | null) ?? undefined,
    providerId: row.providerId ?? undefined,
    modelId: row.modelId ?? undefined,
  };
}
