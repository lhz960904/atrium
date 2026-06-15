import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killProcessTree } from './kill-tree';

const SHELL = process.env.SHELL || '/bin/zsh';

function alive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

test('kills a forked grandchild, not just the shell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atrium-kill-'));
  const pidFile = join(dir, 'gc.pid');
  // The shell forks a grandchild (the `&`), which records its own pid and lingers.
  // A plain child.kill() would reap only the shell and leave this pid running.
  const child = spawn(SHELL, ['-lc', `sh -c 'echo $$ > ${pidFile}; sleep 30' & sleep 30`], {
    detached: true,
  });

  const gotPid = await waitFor(async () => {
    try {
      return (await readFile(pidFile, 'utf8')).trim().length > 0;
    } catch {
      return false;
    }
  });
  expect(gotPid).toBe(true);
  const gcPid = Number((await readFile(pidFile, 'utf8')).trim());
  expect(gcPid).toBeGreaterThan(0);
  expect(alive(gcPid)).toBe(true);

  killProcessTree(child);

  expect(await waitFor(() => !alive(gcPid))).toBe(true);
  await rm(dir, { recursive: true, force: true });
}, 15_000);

test('escalates to SIGKILL when the process ignores SIGTERM', async () => {
  // trap '' TERM makes the shell ignore SIGTERM; only SIGKILL can end it.
  const child = spawn(SHELL, ['-lc', "trap '' TERM; sleep 30"], { detached: true });
  const pid = child.pid;
  expect(pid).toBeDefined();
  await waitFor(() => alive(pid as number), 1_000);

  killProcessTree(child, 200);

  expect(await waitFor(() => !alive(pid as number))).toBe(true);
}, 15_000);
