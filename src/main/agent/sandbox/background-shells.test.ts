import { expect, test } from 'bun:test';
import { BackgroundShells, type ShellProc, type SpawnShell } from './background-shells';

/** A controllable fake pty: tests drive output/exit by hand, no real process. */
class FakeProc implements ShellProc {
  private dataCb: (d: string) => void = () => {};
  private exitCb: (e: { exitCode: number }) => void = () => {};
  killed = false;
  onData(cb: (d: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCb = cb;
  }
  kill(): void {
    this.killed = true;
  }
  emit(d: string): void {
    this.dataCb(d);
  }
  exit(code: number): void {
    this.exitCb({ exitCode: code });
  }
}

/** A registry wired to a fake spawn, plus the handles so tests can drive them. */
function harness() {
  const procs: FakeProc[] = [];
  const spawn: SpawnShell = () => {
    const p = new FakeProc();
    procs.push(p);
    return p;
  };
  return { shells: new BackgroundShells(spawn), procs };
}

test('start returns sequential ids and read returns only new output', () => {
  const { shells, procs } = harness();
  const id = shells.start('npm run dev', '/ws');
  expect(id).toBe('bash_1');

  procs[0].emit('Listening on 3000\n');
  expect(shells.read(id)).toEqual({
    output: 'Listening on 3000\n',
    running: true,
    exitCode: null,
    truncated: false,
  });

  // a second read with no new output returns empty (cursor advanced)
  expect(shells.read(id)?.output).toBe('');

  procs[0].emit('recompiled\n');
  expect(shells.read(id)?.output).toBe('recompiled\n');
});

test('records exit status and code', () => {
  const { shells, procs } = harness();
  const id = shells.start('false', '/ws');
  procs[0].emit('boom\n');
  procs[0].exit(1);
  expect(shells.read(id)).toEqual({
    output: 'boom\n',
    running: false,
    exitCode: 1,
    truncated: false,
  });
});

test('filter keeps only matching lines', () => {
  const { shells, procs } = harness();
  const id = shells.start('npm run dev', '/ws');
  procs[0].emit('info: ok\nERROR: bad\ninfo: fine\nERROR: worse\n');
  expect(shells.read(id, 'ERROR')?.output).toBe('ERROR: bad\nERROR: worse');
});

test('invalid filter regex falls back to unfiltered output', () => {
  const { shells, procs } = harness();
  const id = shells.start('x', '/ws');
  procs[0].emit('a\nb\n');
  expect(shells.read(id, '(')?.output).toBe('a\nb\n');
});

test('caps the buffer and flags truncation, keeping the tail', () => {
  const { shells, procs } = harness();
  const id = shells.start('noisy', '/ws');
  procs[0].emit('x'.repeat(1_000_000));
  procs[0].emit('TAIL');
  const out = shells.read(id);
  expect(out?.truncated).toBe(true);
  expect(out?.output.endsWith('TAIL')).toBe(true);
  expect(out?.output.length).toBe(1_000_000);
});

test('read returns null for an unknown id', () => {
  const { shells } = harness();
  expect(shells.read('bash_99')).toBeNull();
});

test('kill terminates a running shell; no-op when already exited; false when unknown', () => {
  const { shells, procs } = harness();
  const id = shells.start('sleep 999', '/ws');
  expect(shells.kill(id)).toBe(true);
  expect(procs[0].killed).toBe(true);

  const id2 = shells.start('done', '/ws');
  procs[1].exit(0);
  shells.kill(id2);
  expect(procs[1].killed).toBe(false); // already exited, not killed again

  expect(shells.kill('bash_404')).toBe(false);
});

test('killAll terminates only running shells', () => {
  const { shells, procs } = harness();
  shells.start('a', '/ws');
  shells.start('b', '/ws');
  procs[1].exit(0);
  shells.killAll();
  expect(procs[0].killed).toBe(true);
  expect(procs[1].killed).toBe(false);
});
