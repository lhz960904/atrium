import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import { IGNORE_GLOBS } from './ignore';
import { resolveInWorkspace } from './paths';

/**
 * Pure-Node content (grep) and filename (glob) search. File discovery is done
 * by fast-glob — a battle-tested matcher with full glob semantics (globstar,
 * braces, char classes) and forward-slash paths on every OS, so behaviour is
 * identical on macOS/Linux/Windows and the model never has to get shell quoting
 * right. On top of it we add grep's own concerns: binary/size skipping, a line
 * cap against minified files, and a result cap with a truncation flag so a broad
 * search can't flood the context.
 */

const MAX_FILE_SIZE = 1_000_000;
const MAX_LINE_LEN = 2000;
const BINARY_SNIFF = 8192;
const LINE_OUT_LEN = 200;

const GREP_DEFAULT = 100;
const GREP_CAP = 500;
const GLOB_DEFAULT = 200;
const GLOB_CAP = 1000;

export type GrepMatch = { file: string; line: number; text: string };
export type GrepResult = { matches: GrepMatch[]; truncated: boolean };
export type GlobResult = { paths: string[]; truncated: boolean };

export type GrepOptions = {
  pattern: string;
  path?: string;
  glob?: string;
  literal?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
};
export type GlobOptions = { pattern: string; path?: string; maxResults?: number };

const toPosix = (p: string): string => p.split(/[/\\]/).join('/');

const clamp = (v: number | undefined, def: number, cap: number): number =>
  v && v > 0 ? Math.min(v, cap) : def;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Stream files matching `pattern` under `base`, skipping ignored dirs and
 *  symlinks. Yields paths relative to `base` (posix). */
function walk(base: string, pattern: string): AsyncIterable<string> {
  return fg.stream(pattern, {
    cwd: base,
    ignore: IGNORE_GLOBS,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  }) as AsyncIterable<string>;
}

export async function globFiles(root: string, opts: GlobOptions): Promise<GlobResult> {
  const max = clamp(opts.maxResults, GLOB_DEFAULT, GLOB_CAP);
  const base = opts.path ? resolveInWorkspace(root, opts.path) : root;
  const scope = opts.path ? toPosix(relative(root, base)) : '';
  const paths: string[] = [];
  for await (const rel of walk(base, opts.pattern)) {
    if (paths.length >= max) return { paths, truncated: true };
    paths.push(scope ? `${scope}/${rel}` : rel);
  }
  return { paths, truncated: false };
}

export async function grepFiles(root: string, opts: GrepOptions): Promise<GrepResult> {
  const max = clamp(opts.maxResults, GREP_DEFAULT, GREP_CAP);
  const base = opts.path ? resolveInWorkspace(root, opts.path) : root;
  const scope = opts.path ? toPosix(relative(root, base)) : '';
  const re = new RegExp(
    opts.literal ? escapeRegex(opts.pattern) : opts.pattern,
    opts.caseSensitive ? '' : 'i',
  );
  const matches: GrepMatch[] = [];
  for await (const rel of walk(base, opts.glob ?? '**/*')) {
    let buf: Buffer;
    try {
      if ((await stat(join(base, rel))).size > MAX_FILE_SIZE) continue;
      buf = await readFile(join(base, rel));
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    const file = scope ? `${scope}/${rel}` : rel;
    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
      // Skip pathologically long lines (minified bundles) before the regex.
      if (line.length > MAX_LINE_LEN) continue;
      if (re.test(line)) {
        const text = line.length > LINE_OUT_LEN ? `${line.slice(0, LINE_OUT_LEN)}…` : line;
        matches.push({ file, line: i + 1, text });
        if (matches.length >= max) return { matches, truncated: true };
      }
    }
  }
  return { matches, truncated: false };
}
