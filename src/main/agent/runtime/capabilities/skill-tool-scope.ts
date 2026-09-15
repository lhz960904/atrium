import { scopeToolsToSkill } from '../../skills/scope';
import { type ActiveSkill, SKILL_SCRATCH_KEY } from '../../skills/types';
import type { AtriumTool } from '../../tools';
import type { RunContext } from '../run-context';
import type { Capability } from './compose';

/** Recompute from the full catalog so leaving a skill restores tools. Register before hard restrictions. */
export function skillToolScope(tools: AtriumTool[], scratch: RunContext['scratch']): Capability {
  return {
    name: 'skill-tool-scope',
    prepareNextTurn: ({ context }) => ({
      context: {
        ...context,
        tools: scopeToolsToSkill(tools, scratch.get(SKILL_SCRATCH_KEY) as ActiveSkill | undefined),
      },
    }),
  };
}
