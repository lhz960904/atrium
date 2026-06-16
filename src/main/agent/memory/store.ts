import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontmatter, renderFrontmatter } from '../../shared/frontmatter';
import { MEMORY_INDEX } from './paths';

export const MEMORY_TYPES = ['preference', 'project', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryInput = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
};

// Slug the name to a stable, traversal-proof .md filename — the name is the key,
// so re-writing the same name overwrites (replaces) the same file.
export function fileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'memory'}.md`;
}

export function renderTopic(m: MemoryInput): string {
  return renderFrontmatter({ name: m.name, description: m.description, type: m.type }, m.body);
}

type TopicMeta = { name: string; description: string; type: string };

export function parseTopic(content: string): TopicMeta | null {
  const rec = parseFrontmatter(content);
  if (!rec) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const name = str(rec.name);
  const description = str(rec.description);
  const type = str(rec.type);
  return name && description && type ? { name, description, type } : null;
}

export async function writeMemory(dir: string, m: MemoryInput): Promise<string> {
  const file = fileName(m.name);
  await writeFile(join(dir, file), renderTopic(m), 'utf8');
  await regenerateIndex(dir);
  return file;
}

export async function deleteMemory(dir: string, name: string): Promise<void> {
  await rm(join(dir, fileName(name)), { force: true });
  await regenerateIndex(dir);
}

/**
 * Rebuild MEMORY.md from the topic files' frontmatter, so the index can never
 * drift from disk and the model never has to maintain it by hand.
 */
export async function regenerateIndex(dir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  const entries: TopicMeta[] = [];
  for (const file of files) {
    if (!file.endsWith('.md') || file === MEMORY_INDEX) continue;
    const meta = parseTopic(await readFile(join(dir, file), 'utf8').catch(() => ''));
    if (meta) entries.push(meta);
  }
  await writeFile(join(dir, MEMORY_INDEX), renderIndex(entries), 'utf8');
}

function renderIndex(entries: TopicMeta[]): string {
  if (entries.length === 0) return '# Memory\n';
  const byType = new Map<string, TopicMeta[]>();
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byType.get(e.type) ?? [];
    list.push(e);
    byType.set(e.type, list);
  }
  const sections = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([type, list]) =>
        `## ${type}\n${list.map((e) => `- ${e.name} — ${e.description}`).join('\n')}`,
    );
  return `# Memory\n\n${sections.join('\n\n')}\n`;
}
