import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Parse the leading YAML frontmatter into an object; null if absent, invalid YAML, or not an object. */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch {
    return null;
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

/** Drop the leading frontmatter block, returning the trimmed body. */
export function stripFrontmatter(content: string): string {
  return content
    .replace(FRONTMATTER_RE, '')
    .replace(/^\s*\n/, '')
    .trimEnd();
}

/** Render `fields` as YAML frontmatter above `body`. */
export function renderFrontmatter(fields: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(fields).trimEnd()}\n---\n${body.trim()}\n`;
}
