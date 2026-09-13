/**
 * Whether two URLs point at the same document, ignoring hash and query — a
 * reload or a route change rather than a link leading out. `file:` URLs both
 * report a null origin, so the path is what separates a renderer's own
 * document from any other file on disk. Malformed input counts as different.
 */
export function isSameDocument(target: string, current: string): boolean {
  try {
    const a = new URL(target);
    const b = new URL(current);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
