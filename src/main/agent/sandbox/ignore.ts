/**
 * Directory entries the `list` traversal skips — VCS / dependency / build /
 * cache noise that would drown a listing. Pure + dependency-free so it's
 * directly unit-testable.
 */
const IGNORE_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.DS_Store',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'target',
  '.idea',
]);

const IGNORE_SUFFIXES = ['.log', '.tmp', '.pyc'];

export function shouldIgnore(name: string): boolean {
  if (IGNORE_NAMES.has(name)) return true;
  return IGNORE_SUFFIXES.some((s) => name.endsWith(s));
}
