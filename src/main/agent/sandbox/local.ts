import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { shouldIgnore } from './ignore';
import { resolveInWorkspace } from './paths';
import type { Sandbox } from './types';

const EXEC_TIMEOUT_MS = 120_000;

/**
 * Local filesystem + shell sandbox rooted at a workspace directory. NOT a
 * security jail: it confines the *path* tools to the workspace (rejecting
 * `..`/absolute escapes) and runs commands with the user's own permissions —
 * the trust model of a local coding agent.
 *
 * Returns raw content and throws on error; the tools layer truncates output
 * and turns errors into model-readable strings.
 */
export class LocalSandbox implements Sandbox {
  constructor(private readonly root: string) {}

  private resolveInside(p: string): string {
    return resolveInWorkspace(this.root, p);
  }

  async readFile(p: string): Promise<string> {
    return readFile(this.resolveInside(p), 'utf8');
  }

  async writeFile(p: string, content: string, append = false): Promise<{ bytes: number }> {
    const abs = this.resolveInside(p);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, { encoding: 'utf8', flag: append ? 'a' : 'w' });
    return { bytes: Buffer.byteLength(content, 'utf8') };
  }

  async list(p = '.', maxDepth = 2): Promise<string[]> {
    const root = this.resolveInside(p);
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

  exec(command: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolvePromise, reject) => {
      const shell = process.env.SHELL || '/bin/zsh';
      // A pipe (not a PTY): stdout isn't a tty, so CLIs auto-drop color and
      // progress animations, leaving clean text for the model.
      const child = spawn(shell, ['-lc', command], { cwd: this.root, env: process.env });
      let out = '';
      const collect = (d: Buffer): void => {
        out += d.toString('utf8');
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      const timer = setTimeout(() => {
        out += '\n[timed out]';
        child.kill();
      }, EXEC_TIMEOUT_MS);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({ output: out, exitCode: code ?? 0 });
      });
    });
  }
}
