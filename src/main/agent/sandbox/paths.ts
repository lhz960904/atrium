import { resolve, sep } from 'node:path';

/**
 * Resolve a workspace-relative path to an absolute one, rejecting anything
 * that escapes the root (`..` segments, absolute paths outside it). This is
 * the path guard the local sandbox relies on; kept pure + dependency-free so
 * it's directly unit-testable.
 */
export function resolveInWorkspace(root: string, p: string): string {
  const abs = resolve(root, p);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes the workspace: ${p}`);
  }
  return abs;
}
