import { generateText, type LanguageModel, stepCountIs } from 'ai';
import { createLogger } from '../../log';
import { memoryDirTool } from '../tools/builtins/memory';
import { clearSnapshot, rollback, snapshot } from './backup';
import { DREAM_SYSTEM_PROMPT } from './dream-prompt';
import { markConsolidated } from './state';

const log = createLogger('memory');

/**
 * Consolidate one memory dir with a constrained background agent: snapshot first,
 * let the agent dedupe and prune through the memory tool only, then mark it done.
 * Any failure rolls the dir back to the snapshot, so a broken run never corrupts
 * memory. The caller (scheduler) holds the lock and does not await this.
 */
export async function runDream(dir: string, model: LanguageModel): Promise<void> {
  await snapshot(dir);
  try {
    const res = await generateText({
      model,
      system: DREAM_SYSTEM_PROMPT,
      prompt: `Consolidate the memory in ${dir}. Start by viewing the index.`,
      tools: { memory: memoryDirTool(dir) },
      stopWhen: stepCountIs(40),
    });
    await markConsolidated(dir, Date.now());
    await clearSnapshot(dir);
    log.info(`dream consolidated ${dir} in ${res.steps.length} step(s)`);
  } catch (err) {
    await rollback(dir);
    throw err;
  }
}
