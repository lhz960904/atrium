import { expect, test } from 'bun:test';
import { BackgroundShells, type ShellProc, type SpawnShell } from '../../sandbox/background-shells';
import type { Sandbox } from '../../sandbox/types';
import type { ToolCtx } from '../context';
import { fakeRun, runTool } from '../testing';
import { killShellTool } from './kill-shell';

const sandbox: Sandbox = {
  readFile: async () => '',
  readFileBytes: async () => new Uint8Array(),
  writeFile: async () => ({ bytes: 0 }),
  list: async () => [],
  exec: async () => ({ output: '', exitCode: 0 }),
};
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
  const ctx: ToolCtx = { sandbox, workspaceRoot: '/ws', run: fakeRun(), bgShells };
  return { ctx, bgShells, procs };
}

test('stops a running shell', async () => {
  const { ctx, bgShells, procs } = harness();
  const id = bgShells.start('sleep 999', '/ws');
  expect(await runTool(killShellTool(ctx), { shell_id: id })).toBe(
    'Stopped background shell bash_1.',
  );
  expect(procs[0].killed).toBe(true);
});

test('fails for an unknown shell id', async () => {
  const { ctx } = harness();
  expect(runTool(killShellTool(ctx), { shell_id: 'bash_42' })).rejects.toThrow(
    'no background shell with id bash_42.',
  );
});

test('fails when the registry is unavailable', async () => {
  const ctx: ToolCtx = { sandbox, workspaceRoot: '/ws', run: fakeRun() };
  expect(runTool(killShellTool(ctx), { shell_id: 'bash_1' })).rejects.toThrow('unavailable');
});
