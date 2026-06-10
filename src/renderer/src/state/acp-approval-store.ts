import type { AtriumDataParts } from '@shared/chat';
import { create } from 'zustand';

export type AcpPendingApproval = AtriumDataParts['permissionRequest'];

/**
 * External (ACP) agents' permission asks awaiting the user, keyed by threadId.
 * Fed by the Chat's onData handler from `data-permissionRequest` parts; entries
 * leave on the matching `data-permissionResolved` receipt (which also nets out
 * replayed already-answered asks after a reload), on the user's own answer
 * (optimistic remove), or wholesale when the turn ends. A queue, not a single
 * slot: the protocol allows concurrent asks, and overwriting would orphan a
 * parked request that then could never be answered.
 */
type AcpApprovalState = {
  byThread: Record<string, AcpPendingApproval[] | undefined>;
  push: (threadId: string, approval: AcpPendingApproval) => void;
  remove: (threadId: string, requestId: string) => void;
  clear: (threadId: string) => void;
};

export const useAcpApprovalStore = create<AcpApprovalState>((set) => ({
  byThread: {},
  push: (threadId, approval) =>
    set((s) => ({
      byThread: { ...s.byThread, [threadId]: [...(s.byThread[threadId] ?? []), approval] },
    })),
  remove: (threadId, requestId) =>
    set((s) => ({
      byThread: {
        ...s.byThread,
        [threadId]: (s.byThread[threadId] ?? []).filter((a) => a.requestId !== requestId),
      },
    })),
  clear: (threadId) => set((s) => ({ byThread: { ...s.byThread, [threadId]: undefined } })),
}));
