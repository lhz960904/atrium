import { resolve, sep } from 'node:path';

/**
 * Resolve a path to absolute against the workspace root, with no boundary
 * check: relative paths resolve under the root, absolute paths pass through.
 * Reads use this (allowed anywhere on disk), and so do writes — whose workspace
 * boundary is enforced by the permission gate, not by this resolver.
 */
export function resolveAbsolute(root: string, p: string): string {
  return resolve(root, p);
}

/**
 * Resolve a path and throw if it escapes the root (`..` segments, absolute
 * paths outside it). No longer guards the sandbox; it's the escape DETECTOR the
 * permission layer uses — a throw means "this write crosses the workspace
 * boundary" and triggers an approval prompt. Kept pure + dependency-free so
 * it's directly unit-testable.
 */
export function resolveInWorkspace(root: string, p: string): string {
  const abs = resolve(root, p);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes the workspace: ${p}`);
  }
  return abs;
}
