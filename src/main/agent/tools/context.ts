import type { Sandbox } from '../sandbox/types';

/**
 * Injected into every tool factory. `workspaceRoot` lets path tools normalize
 * the model's path (relative or absolute) to an absolute one under the root
 * via resolveInWorkspace — the sandbox guards again as a safety net.
 */
export type ToolCtx = { sandbox: Sandbox; workspaceRoot: string };
