import { homedir } from 'node:os';
import { discoverInstructions, type InstructionFile } from '../../instructions';
import { injectSystemReminder } from '../shared/reminder';
import type { AgentMiddleware, RunContext } from '../types';

export type InstructionsOptions = { home?: string };

const PREAMBLE =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';

function render(files: InstructionFile[]): string {
  const blocks = files.map((f) => `Contents of ${f.path}:\n${f.content}`).join('\n\n');
  return `<custom-instructions>\n${PREAMBLE}\n\n${blocks}\n</custom-instructions>`;
}

export function instructionsMiddleware(options: InstructionsOptions = {}): AgentMiddleware {
  const home = options.home ?? homedir();
  return {
    name: 'instructions',
    async beforeRun(ctx: RunContext): Promise<void> {
      const files = await discoverInstructions(home, ctx.workspaceRoot);
      if (files.length === 0) return;
      ctx.request.messages = injectSystemReminder(ctx.request.messages, render(files));
    },
  };
}
