import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { PermissionMode } from '@shared/permissions';
import type { TrustRule } from '@shared/permissions/rules';
import type { ComputerUseHelper } from '../../computer-use';
import type { Complete } from '../pi/complete';
import type { RunContext } from '../run-context';
import type { BackgroundShells } from '../sandbox/background-shells';
import type { Sandbox } from '../sandbox/types';
import type { Skill } from '../skills/types';
import type { AtriumTool } from './define';

/**
 * Injected into every tool factory. `workspaceRoot` lets path tools normalize
 * the model's path (relative or absolute) to an absolute one against the root
 * via resolveAbsolute; reads may reach outside it, while out-of-workspace
 * writes are gated by the permission layer. `run` is the turn's own context,
 * which is why the toolset is built per run: the tools that reach back into the
 * turn (task's subagent, skill activation) close over
 * it instead of being handed a context at call time. `skills` are the ones
 * discovered at startup, so the skill tool can load a body by name; absent
 * until discovery is wired, so it defaults to none. `bgShells` is the
 * main-process registry of long-running shells (a singleton shared across
 * requests), so the background bash / bash_output / kill_shell tools reach the
 * same processes turn to turn.
 */
export type ToolCtx = {
  sandbox: Sandbox;
  workspaceRoot: string;
  run: RunContext;
  skills?: Skill[];
  bgShells?: BackgroundShells;
  /** Tools from connected MCP servers, named mcp__<server>__<tool>. */
  mcpTools?: AtriumTool[];
  /** How the turn reaches its provider, so a nested loop (task) can reuse it. */
  engine?: {
    model: Model<Api>;
    streamFn: StreamFn;
    getApiKey: (provider: string) => string | undefined;
  };
  /** The Computer Use helper (macOS desktop automation); absent off macOS. */
  computerUse?: ComputerUseHelper;
  /** Whether the active provider+model can consume image tool results (see
   *  supportsImageToolResults). Absent defaults to false on purpose: a dropped
   *  image degrades to a text note the model can react to, while wrongly
   *  emitting image parts lets openai-compatible stringify base64 into the
   *  prompt. */
  supportsImageToolResults?: boolean;
  permission?: {
    mode: PermissionMode;
    rules?: TrustRule[];
    /** Reviewer for auto-review mode; absent → auto-review falls back to prompting. */
    review?: Complete;
    /** The turn's abort signal, so a stopped turn also cancels an in-flight review. */
    abortSignal?: AbortSignal;
  };
};
