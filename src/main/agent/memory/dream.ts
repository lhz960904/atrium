import { Agent } from '@earendil-works/pi-agent-core';
import { createLogger } from '../../log';
import type { SubagentEngine } from '../subagent/run';
import { memoryDirTool } from '../tools/builtins/memory';
import { clearSnapshot, rollback, snapshot } from './backup';
import { DREAM_SYSTEM_PROMPT } from './dream-prompt';
import { markConsolidated } from './state';

const log = createLogger('memory');

/** Enough turns to walk an index and rewrite a handful of entries, not a runaway. */
const DREAM_MAX_TURNS = 40;

/**
 * Consolidate one memory dir with a constrained background agent: snapshot first,
 * let the agent dedupe and prune through the memory tool only, then mark it done.
 * Any failure rolls the dir back to the snapshot, so a broken run never corrupts
 * memory. The caller (scheduler) holds the lock and does not await this.
 */
export async function runDream(dir: string, engine: SubagentEngine): Promise<void> {
  await snapshot(dir);
  try {
    let turns = 0;
    const agent = new Agent({
      initialState: {
        systemPrompt: DREAM_SYSTEM_PROMPT,
        model: engine.model,
        tools: [memoryDirTool(dir)],
        messages: [
          {
            role: 'user',
            content: `Consolidate the memory in ${dir}. Start by viewing the index.`,
            timestamp: Date.now(),
          },
        ],
      },
      streamFn: engine.streamFn,
      getApiKey: engine.getApiKey,
      shouldStopAfterTurn: () => ++turns >= DREAM_MAX_TURNS,
    });
    await agent.continue();
    await markConsolidated(dir, Date.now());
    await clearSnapshot(dir);
    log.info(`dream consolidated ${dir} in ${turns} turn(s)`);
  } catch (err) {
    await rollback(dir);
    throw err;
  }
}
