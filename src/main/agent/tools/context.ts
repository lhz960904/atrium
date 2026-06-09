import type { PermissionMode } from '@shared/permissions';
import type { Db } from '../../db';
import type { BackgroundShells } from '../sandbox/background-shells';
import type { Sandbox } from '../sandbox/types';
import type { Skill } from '../skills/types';

/**
 * Injected into every tool factory. `workspaceRoot` lets path tools normalize
 * the model's path (relative or absolute) to an absolute one under the root
 * via resolveInWorkspace — the sandbox guards again as a safety net. `db` is
 * here for tools that need it (e.g. task, to list the available subagents).
 * `skills` are the ones discovered at startup, so the skill tool can load a
 * body by name; absent until discovery is wired, so it defaults to none.
 * `bgShells` is the main-process registry of long-running shells (a singleton
 * shared across requests), so the background bash / bash_output / kill_shell
 * tools reach the same processes turn to turn.
 */
export type ToolCtx = {
  sandbox: Sandbox;
  workspaceRoot: string;
  db: Db;
  skills?: Skill[];
  bgShells?: BackgroundShells;
  permission?: { mode: PermissionMode };
};
