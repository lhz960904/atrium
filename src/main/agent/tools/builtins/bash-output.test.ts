import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import { BackgroundShells, type ShellProc, type SpawnShell } from '../../sandbox/background-shells';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { bashOutputTool } from './bash-output';

const sandbox: Sandbox = {
  readFile: async () => '',
  readFileBytes: async () => new Uint8Array(),
  writeFile: async () => ({ bytes: 0 }),
  list: async () => [],
  exec: async () => ({ output: '', exitCode: 0 }),
};
// biome-ignore lint/suspicious/noExplicitAny: execute's option arg is irrelevant here
const opts = {} as any;

class FakeProc implements ShellProc {
  private d: (s: string) => void = () => {};
  private e: (x: { exitCode: number }) => void = () => {};
  onData(cb: (s: string) => void): void {
    this.d = cb;
  }
  onExit(cb: (x: { exitCode: number }) => void): void {
    this.e = cb;
  }
  kill(): void {}
  emit(s: string): void {
    this.d(s);
  }
  exit(code: number): void {
    this.e({ exitCode: code });
  }
}

function harness() {
  const procs: FakeProc[] = [];
  const spawn: SpawnShell = () => {
    const p = new FakeProc();
    procs.push(p);
    return p;
  };
  const bgShells = new BackgroundShells(spawn);
  const ctx: ToolCtx = { sandbox, workspaceRoot: '/ws', db: {} as Db, bgShells };
  return { ctx, bgShells, procs };
}

test('formats new output with running status', async () => {
  const { ctx, bgShells, procs } = harness();
  const id = bgShells.start('npm run dev', '/ws');
  procs[0].emit('Listening on 3000\n');
  const out = await bashOutputTool(ctx).execute?.({ shell_id: id }, opts);
  expect(out).toBe('Shell bash_1 [running]\nListening on 3000\n');
});

test('shows exited status with code and (no new output) after draining', async () => {
  const { ctx, bgShells, procs } = harness();
  const id = bgShells.start('false', '/ws');
  procs[0].emit('done\n');
  procs[0].exit(1);
  const t = bashOutputTool(ctx);
  await t.execute?.({ shell_id: id }, opts); // first read drains the buffer
  const out = await t.execute?.({ shell_id: id }, opts);
  expect(out).toBe('Shell bash_1 [exited (code 1)]\n(no new output)');
});

test('errors for an unknown shell id', async () => {
  const { ctx } = harness();
  expect(await bashOutputTool(ctx).execute?.({ shell_id: 'bash_99' }, opts)).toBe(
    'Error: no background shell with id bash_99.',
  );
});

test('errors when the registry is unavailable', async () => {
  const ctx: ToolCtx = { sandbox, workspaceRoot: '/ws', db: {} as Db };
  expect(await bashOutputTool(ctx).execute?.({ shell_id: 'bash_1' }, opts)).toContain(
    'unavailable',
  );
});
