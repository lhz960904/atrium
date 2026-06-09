import { commandName, splitSubcommands, subcommand } from './command';
import { isDangerous, isWrapper, NETWORK_COMMANDS, NETWORK_SUBCOMMANDS } from './lists';

export type BoundaryKind = 'fs-escape' | 'network' | 'dangerous' | 'opaque';

export type Crossing = { kind: BoundaryKind; reason: string };

/**
 * Analyze a bash command for a boundary crossing — network access, a
 * destructive command, or something opaque we can't read statically
 * (substitution, a wrapper that hides the real command, an unparseable line).
 * Returns null when the command stays inside the workspace. Pure and
 * dependency-light so both the main gate and the renderer's approval card
 * share one source of truth; without an OS sandbox this is a heuristic, not a
 * security boundary, so it errs toward flagging what it can't read.
 */
export function analyzeBash(command: string): Crossing | null {
  const cmd = command.trim();
  if (!cmd) return null;

  // e.g. echo $(whoami) , cat `which node` — substitution hides an inner command
  if (/`|\$\(/.test(cmd)) {
    return { kind: 'opaque', reason: '命令含替换（$() 或反引号），无法静态判定' };
  }

  const segments = splitSubcommands(cmd);
  // e.g. unbalanced quotes — shell-quote throws, can't read it → flag
  if (!segments) {
    return { kind: 'opaque', reason: '命令无法解析，保险起见需确认' };
  }

  for (const tokens of segments) {
    const name = commandName(tokens);
    if (!name) continue;
    // e.g. rm -rf build , sudo apt-get update , chmod 777 x , mkfs.ext4 /dev/sda
    if (isDangerous(name)) return { kind: 'dangerous', reason: `危险命令：${name}` };
    // e.g. env FOO=bar curl … , timeout 5 rm x , bash deploy.sh — wraps the real command
    if (isWrapper(name)) {
      return { kind: 'opaque', reason: `包装执行（${name}），无法静态判定真实命令` };
    }
    // e.g. curl https://… , wget … , ssh … , npx create-foo
    if (NETWORK_COMMANDS.has(name)) {
      return { kind: 'network', reason: `联网命令：${name}` };
    }
    const sub = subcommand(tokens);
    // e.g. git push , npm install lodash , pip install requests — local cmd, networked sub
    if (sub && NETWORK_SUBCOMMANDS[name]?.has(sub)) {
      return { kind: 'network', reason: `联网命令：${name} ${sub}` };
    }
  }
  // e.g. ls -la , git status , bun run build , mkdir build && cd build — stays inside, allow
  return null;
}

/** Describe a write landing outside the workspace — the only file crossing. e.g. ../secret.txt , /etc/hosts */
export function describeWriteEscape(path: string): Crossing {
  return { kind: 'fs-escape', reason: `写入 workspace 外的路径：${path}` };
}
