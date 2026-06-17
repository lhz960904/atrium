import {
  MEMORY_INDEX_BUDGET,
  MEMORY_SCOPES,
  type MemoryScope,
  memoryDir,
} from '../../memory/paths';
import { recordSessionTouch } from '../../memory/state';
import { readIndexClipped } from '../../memory/store';
import { injectSystemReminder } from '../shared/reminder';
import type { AgentMiddleware, RunContext } from '../types';

export type MemoryOptions = {
  /** Resolve a scope's memory dir; defaults to the app-data location. Injectable for tests. */
  resolveDir?: (scope: MemoryScope, workspaceRoot: string) => string;
};

export function memoryMiddleware(opts: MemoryOptions = {}): AgentMiddleware {
  const resolveDir = opts.resolveDir ?? memoryDir;
  return {
    name: 'memory',

    async beforeRun(ctx: RunContext): Promise<void> {
      // Inject specific-first so the broad (global) block lands on top after prepend.
      for (const scope of [...MEMORY_SCOPES].reverse()) {
        const index = await readIndexClipped(
          resolveDir(scope, ctx.workspaceRoot),
          MEMORY_INDEX_BUDGET,
        );
        if (!index.includes('\n- ')) continue; // header-only / absent → nothing to inject
        ctx.request.messages = injectSystemReminder(
          ctx.request.messages,
          `<memory scope="${scope}">\nDurable ${scope} memory. Read an entry in full with the memory tool (view, scope=${scope}, name=…) before relying on it.\n\n${index}\n</memory>`,
        );
      }
    },

    // Only counts the session; the dream scheduler reads this to decide when to consolidate.
    async afterRun(ctx: RunContext): Promise<void> {
      for (const scope of MEMORY_SCOPES) {
        await recordSessionTouch(resolveDir(scope, ctx.workspaceRoot), ctx.threadId);
      }
    },
  };
}
