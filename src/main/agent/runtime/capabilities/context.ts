import { withinTurnFold } from '../../context/compaction';
import { injectContextBlocks } from '../../context/injectors';
import { screenshotTrim } from '../../context/screenshot-trim';
import { injectSystemReminder } from '../../context/system-reminder';
import { currentDateNote } from '../../prompts';
import type { Capability } from './compose';

export function screenshotContext(workspaceRoot: string): Capability {
  const transform = screenshotTrim(workspaceRoot);
  return { name: 'screenshot-context', transformContext: async (messages) => transform(messages) };
}

export function contextCompaction(options: Parameters<typeof withinTurnFold>[0]): Capability {
  const transform = withinTurnFold(options);
  return { name: 'context-compaction', transformContext: async (messages) => transform(messages) };
}

export function contextInjection(blocks: string[]): Capability {
  const transform = injectContextBlocks(blocks);
  return { name: 'context-injection', transformContext: async (messages) => transform(messages) };
}

export function dateReminder(): Capability {
  return {
    name: 'date-reminder',
    transformContext: async (messages) =>
      injectSystemReminder(messages, currentDateNote(new Date()), { anchor: 'last' }),
  };
}
