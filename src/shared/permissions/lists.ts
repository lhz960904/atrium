/**
 * Heuristic command lists for the workspace-boundary check. Deliberately small
 * and extensible: without an OS sandbox this is a best-effort denylist, not a
 * security boundary. What it misses, the Auto-review mode's model reviewer is
 * meant to catch.
 */

/** Commands that reach the network on their own. */
export const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ftp',
  'telnet',
  'npx',
  'bunx',
]);

/**
 * Commands whose network access is gated on a subcommand — `git` is local but
 * `git push` is not. Matched against the first argument after the command name.
 * Heuristic: flags before the subcommand (`git -C foo push`) aren't handled.
 */
export const NETWORK_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  git: new Set(['push', 'pull', 'fetch', 'clone', 'remote', 'submodule']),
  npm: new Set(['install', 'i', 'ci', 'add', 'update', 'publish', 'audit', 'exec', 'dlx']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'publish', 'dlx']),
  yarn: new Set(['install', 'add', 'up', 'upgrade', 'publish']),
  bun: new Set(['install', 'i', 'add', 'update', 'publish']),
  pip: new Set(['install', 'download']),
  pip3: new Set(['install', 'download']),
  poetry: new Set(['add', 'install', 'update']),
  cargo: new Set(['install', 'publish', 'add']),
  go: new Set(['get', 'install']),
  gem: new Set(['install', 'update', 'push']),
  brew: new Set(['install', 'update', 'upgrade', 'fetch', 'tap']),
  apt: new Set(['install', 'update', 'upgrade']),
  'apt-get': new Set(['install', 'update', 'upgrade']),
  yum: new Set(['install', 'update']),
  dnf: new Set(['install', 'update']),
  docker: new Set(['pull', 'push']),
};

const DANGEROUS_COMMANDS = new Set([
  'rm',
  'rmdir',
  'dd',
  'shred',
  'truncate',
  'sudo',
  'su',
  'doas',
  'chmod',
  'chown',
  'chgrp',
  'kill',
  'killall',
  'pkill',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'mount',
  'umount',
  'fdisk',
  'parted',
  'mkswap',
  'eval',
  'exec',
  'source',
]);

/**
 * Wrappers that run another command, hiding the real one from a static read
 * (`env FOO=bar curl …`, `timeout 5 rm …`). Treated as "can't tell" → ask.
 */
const COMMAND_WRAPPERS = new Set([
  'env',
  'nohup',
  'timeout',
  'time',
  'nice',
  'xargs',
  'watch',
  'bash',
  'sh',
  'zsh',
  'fish',
]);

export function isDangerous(name: string): boolean {
  return DANGEROUS_COMMANDS.has(name) || name.startsWith('mkfs');
}

export function isWrapper(name: string): boolean {
  return COMMAND_WRAPPERS.has(name);
}
