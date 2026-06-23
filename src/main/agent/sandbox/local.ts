import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { shouldIgnore } from './ignore';
import { killProcessTree } from './kill-tree';
import { resolveAbsolute } from './paths';
import type { Sandbox } from './types';

const EXEC_TIMEOUT_MS = 120_000;

/**
 * Local filesystem + shell sandbox rooted at a workspace directory. NOT a
 * security jail: relative paths resolve against the root and commands run with
 * the user's own permissions — the trust model of a local coding agent. Reads
 * may reach anywhere on disk; the workspace-write boundary is enforced upstream
 * by the permission gate, not here.
 *
 * Returns raw content and throws on error; the tools layer truncates output
 * and turns errors into model-readable strings.
 */
export class LocalSandbox implements Sandbox {
  constructor(private readonly root: string) {}

  async readFile(p: string): Promise<string> {
    return readFile(resolveAbsolute(this.root, p), 'utf8');
  }

  async writeFile(p: string, content: string, append = false): Promise<{ bytes: number }> {
    const abs = resolveAbsolute(this.root, p);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    return { bytes: Buffer.byteLength(content, 'utf8') };
  }

  async list(p = '.', maxDepth = 2): Promise<string[]> {
    const root = resolveAbsolute(this.root, p);
    const out: string[] = [];
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (shouldIgnore(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          out.push(`${childRel}/`);
          if (depth < maxDepth) await walk(join(dir, e.name), childRel, depth + 1);
        } else {
          out.push(childRel);
        }
      }
    };
    await walk(root, '', 1);
    return out;
  }

  /**
   * `signal` wires this command to the run's cancellation: stopping the turn (or
   * hitting the timeout) kills the whole process tree, not just the shell, so a
   * dev server / compiler the command forked can't outlive the turn as an
   * orphan. A user-driven abort is an expected stop, not a failure, so it settles
   * gracefully rather than throwing.
   */
  exec(
    command: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolvePromise, reject) => {
      const signal = opts?.signal;
      if (signal?.aborted) {
        resolvePromise({ output: '[aborted]', exitCode: 1 });
        return;
      }
      const shell = process.env.SHELL || '/bin/zsh';
      // A pipe (not a PTY): stdout isn't a tty, so CLIs auto-drop color and
      // progress animations, leaving clean text for the model. `detached` puts
      // the shell in its own process group so killProcessTree can reap whatever
      // it spawned.
      const child = spawn(shell, ['-lc', command], {
        cwd: this.root,
        env: process.env,
        detached: true,
      });
      let out = '';
      let settled = false;
      const collect = (d: Buffer): void => {
        out += d.toString('utf8');
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      const onAbort = (): void => {
        out += '\n[aborted]';
        killProcessTree(child);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        out += '\n[timed out]';
        killProcessTree(child);
      }, EXEC_TIMEOUT_MS);
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        settle();
      };
      child.on('error', (err) => finish(() => reject(err)));
      child.on('close', (code) =>
        finish(() => resolvePromise({ output: out.trim(), exitCode: code ?? 0 })),
      );
    });
  }
}
