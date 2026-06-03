import type { SubagentActivityTool } from '@shared/chat';
import type { SubagentStatus } from '@shared/chat-types';
import { create } from 'zustand';

/**
 * Live activity of delegated subagents, keyed by the task tool's call id. Fed by
 * the Chat's onData handler from transient `data-subagent` events, read by
 * SubagentCard to show a nested trace while the subagent runs. Transient — never
 * persisted, so a reloaded card falls back to showing just its result/status.
 */
type Entry = { status: SubagentStatus; tools: SubagentActivityTool[] };

type SubagentState = {
  byId: Record<string, Entry>;
  start: (id: string) => void;
  addTools: (id: string, tools: SubagentActivityTool[]) => void;
  finish: (id: string, status: 'done' | 'failed') => void;
};

const entryOf = (s: SubagentState, id: string): Entry =>
  s.byId[id] ?? { status: 'streaming', tools: [] };

export const useSubagentStore = create<SubagentState>((set) => ({
  byId: {},
  start: (id) => set((s) => ({ byId: { ...s.byId, [id]: { status: 'streaming', tools: [] } } })),
  addTools: (id, tools) =>
    set((s) => {
      const prev = entryOf(s, id);
      return { byId: { ...s.byId, [id]: { ...prev, tools: [...prev.tools, ...tools] } } };
    }),
  finish: (id, status) =>
    set((s) => ({ byId: { ...s.byId, [id]: { ...entryOf(s, id), status } } })),
}));
