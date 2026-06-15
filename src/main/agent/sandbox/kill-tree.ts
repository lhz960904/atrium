import type { ChildProcess } from 'node:child_process';

const KILL_GRACE_MS = 4_000;

/**
 * Terminate a detached child process AND every process it spawned.
 *
 * A child started with `detached: true` becomes its own process-group leader
 * (the group id equals its pid), so signaling the *negative* pid reaches the
 * whole group: the shell plus the dev server / watcher / compiler it forked. A
 * plain `child.kill()` signals only the shell, leaving those grandchildren
 * orphaned — holding ports, burning CPU, surviving app quit.
 *
 * SIGTERM first for a clean shutdown; if the group is still alive after a grace
 * period (something trapped or ignored SIGTERM), escalate to SIGKILL. The grace
 * timer is unref'd so it never keeps the app alive on its own, and the liveness
 * recheck avoids racing a SIGKILL against a pid the OS has already recycled.
 */
export function killProcessTree(child: ChildProcess, graceMs = KILL_GRACE_MS): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (!signalGroup(pid, 'SIGTERM')) return;
  const timer = setTimeout(() => {
    if (signalGroup(pid, 0)) signalGroup(pid, 'SIGKILL');
  }, graceMs);
  timer.unref?.();
}

/** Signal a whole process group by negative pid. Signal 0 just tests liveness. Returns false if the group is already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    return process.kill(-pid, signal);
  } catch {
    return false;
  }
}
