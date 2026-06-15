import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverInstructions } from './discover';
import type { InstructionFile } from './types';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

/** Build a temp tree from {relativePath: content} and return its absolute root. */
async function layout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'instr-'));
  created.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return root;
}

// Filter to our temp root: the ancestor walk reaches '/', so a stray AGENTS.md above must not flake the test.
function shape(files: InstructionFile[], root: string) {
  return files
    .filter((f) => f.path.startsWith(root))
    .map((f) => ({ kind: f.kind, scope: f.scope, content: f.content }));
}

test('layers globals + ancestor chain general→specific', async () => {
  const root = await layout({
    'home/.codex/AGENTS.md': 'codex-global',
    'home/.claude/CLAUDE.md': 'claude-global',
    'ws/AGENTS.md': 'ws-root-agents',
    'ws/a/AGENTS.md': 'a-agents',
    'ws/a/CLAUDE.md': 'a-claude',
    'ws/a/b/CLAUDE.md': 'b-claude',
  });

  const files = await discoverInstructions(join(root, 'home'), join(root, 'ws', 'a', 'b'));

  expect(shape(files, root)).toEqual([
    { kind: 'agents', scope: 'global', content: 'codex-global' },
    { kind: 'claude', scope: 'global', content: 'claude-global' },
    { kind: 'agents', scope: 'project', content: 'ws-root-agents' },
    { kind: 'agents', scope: 'project', content: 'a-agents' },
    { kind: 'claude', scope: 'project', content: 'b-claude' },
  ]);
});

test('same directory: AGENTS wins, CLAUDE ignored', async () => {
  const root = await layout({
    'ws/AGENTS.md': 'agents-here',
    'ws/CLAUDE.md': 'claude-here',
  });

  const files = await discoverInstructions(join(root, 'home'), join(root, 'ws'));

  const project = shape(files, root).filter((f) => f.scope === 'project');
  expect(project).toEqual([{ kind: 'agents', scope: 'project', content: 'agents-here' }]);
});

test('blank AGENTS falls through to CLAUDE in the same directory', async () => {
  const root = await layout({
    'ws/AGENTS.md': '   \n  ',
    'ws/CLAUDE.md': 'claude-here',
  });

  const files = await discoverInstructions(join(root, 'home'), join(root, 'ws'));

  const project = shape(files, root).filter((f) => f.scope === 'project');
  expect(project).toEqual([{ kind: 'claude', scope: 'project', content: 'claude-here' }]);
});

test('budget is spent specific-first; broad files clip then drop', async () => {
  const big = 'x'.repeat(100);
  const root = await layout({
    'home/.codex/AGENTS.md': big,
    'home/.claude/CLAUDE.md': big,
    'ws/AGENTS.md': big,
    'ws/a/AGENTS.md': big,
    'ws/a/b/CLAUDE.md': big,
  });

  const files = await discoverInstructions(join(root, 'home'), join(root, 'ws', 'a', 'b'), 250);
  const kept = files.filter((f) => f.path.startsWith(root));

  // Globals (broadest) are dropped; the three project files remain, general→specific.
  expect(kept.map((f) => f.scope)).toEqual(['project', 'project', 'project']);
  expect(kept[2].content).toBe(big); // most specific: full
  expect(kept[1].content).toBe(big); // next: full
  expect(kept[0].content.endsWith('…[truncated]')).toBe(true); // broadest survivor: clipped
});

test('no instruction files anywhere → empty', async () => {
  const root = await layout({});
  const files = await discoverInstructions(join(root, 'home'), join(root, 'ws', 'deep'));
  expect(shape(files, root)).toEqual([]);
});
