import type { RunContext } from '../middleware/types';
import type { AtriumTool } from './define';

/** Test-only helpers for driving a tool the way the engine does. */

/** A RunContext stub carrying only what tools reach for. */
export function fakeRun(over: Partial<RunContext> = {}): RunContext {
  return {
    threadId: 'thread-test',
    scratch: new Map<string, unknown>(),
    emit: () => {},
    request: { system: '', messages: [], tools: {} },
    ...over,
  } as RunContext;
}

/** Execute a tool and flatten its content to the text the model would read. */
export async function runTool(t: AtriumTool, input: object, signal?: AbortSignal): Promise<string> {
  const { content } = await t.execute('call-1', input, signal);
  return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
}
