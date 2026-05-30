import type { Sandbox } from '../sandbox/types';

/** Injected into every tool factory so `execute` can reach the sandbox. */
export type ToolCtx = { sandbox: Sandbox };
