import { expect, test } from 'bun:test';
import type { Db } from '../../../db';
import { BackgroundShells, type ShellProc, type SpawnShell } from '../../sandbox/background-shells';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { killShellTool } from './kill-shell';

const sandbox: Sandbox = {
  readFile: async () => '',
  writeFile: async () => ({ bytes: 0 }),
  list: async () => [],
  exec: async () => ({ output: '', exitCode: 0 }),
};
// biome-ignore lint/suspicious/noExplicitAny: execute's option arg is irrelevant here
const opts = {} as any;

class FakeProc implements ShellProc {
  killed = false;
  onData(): void {}
  onExit(): void {}
  kill(): void {
    this.killed = true;
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

test('stops a running shell', async () => {
  const { ctx, bgShells, procs } = harness();
  const id = bgShells.start('sleep 999', '/ws');
  expect(await killShellTool(ctx).execute?.({ shell_id: id }, opts)).toBe(
    'Stopped background shell bash_1.',
  );
  expect(procs[0].killed).toBe(true);
});

test('errors for an unknown shell id', async () => {
  const { ctx } = harness();
  expect(await killShellTool(ctx).execute?.({ shell_id: 'bash_42' }, opts)).toBe(
    'Error: no background shell with id bash_42.',
  );
});

test('errors when the registry is unavailable', async () => {
  const ctx: ToolCtx = { sandbox, workspaceRoot: '/ws', db: {} as Db };
  expect(await killShellTool(ctx).execute?.({ shell_id: 'bash_1' }, opts)).toContain('unavailable');
});
