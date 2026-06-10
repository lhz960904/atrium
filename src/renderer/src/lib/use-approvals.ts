import type { AcpPermissionDecision, AtriumUIMessage } from '@shared/chat';
import type { ChatAddToolApproveResponseFunction, ChatStatus } from 'ai';
import { useCallback, useEffect, useMemo } from 'react';
import { useAcpApprovalStore } from '../state/acp-approval-store';
import { acpToPendingApproval, getPendingApprovals, type PendingApproval } from './approvals';
import { trpc } from './trpc';

type UseApprovalsOptions = {
  threadId: string;
  messages: AtriumUIMessage[];
  status: ChatStatus;
  endpoint: { baseUrl: string; token: string };
  /** useChat's addToolApprovalResponse — the native answer path. */
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
};

/**
 * The thread's pending approvals and their decision handlers, merging the two
 * sources behind one PendingApproval list so the chat view doesn't know which
 * is which. Native (our agent loop): pending parts live in the messages, the
 * answer goes through addToolApprovalResponse (ends the turn, auto-resumes),
 * and "always" also persists a trust rule. ACP (external agent): pending asks
 * live in the acp store, and the answer goes to the acp-permission endpoint —
 * the agent is blocked mid-prompt on it, so it unblocks the live turn in place;
 * "always" is remembered by the agent itself. A thread's turn runs one agent or
 * the other, so at most one source is non-empty (ACP takes the slot).
 */
export function useApprovals({
  threadId,
  messages,
  status,
  endpoint,
  addToolApprovalResponse,
}: UseApprovalsOptions): {
  approvals: PendingApproval[];
  onApprove: (approvalId: string) => void;
  onAlways: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
} {
  const acpQueue = useAcpApprovalStore((s) => s.byThread[threadId]);
  const addRule = trpc.settings.addTrustRule.useMutation();

  const approvals = useMemo(
    () => (acpQueue?.length ? acpQueue.map(acpToPendingApproval) : getPendingApprovals(messages)),
    [acpQueue, messages],
  );

  // Once the turn is over nothing is waiting anymore (main settled parked asks
  // as cancelled) — drop leftovers so no unanswerable card lingers.
  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') return;
    useAcpApprovalStore.getState().clear(threadId);
  }, [status, threadId]);

  // Answer an external agent's parked ask: optimistic local remove (the server
  // receipt is a no-op then), then the decision goes to the side endpoint that
  // unblocks the live turn — NOT addToolApprovalResponse, which would start a
  // whole new turn against an agent that's still mid-prompt.
  const answerAcp = useCallback(
    (requestId: string, decision: AcpPermissionDecision): void => {
      useAcpApprovalStore.getState().remove(threadId, requestId);
      void fetch(`${endpoint.baseUrl}/api/chat/${threadId}/acp-permission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-atrium-token': endpoint.token },
        body: JSON.stringify({ requestId, decision }),
      }).catch(() => {});
    },
    [endpoint.baseUrl, endpoint.token, threadId],
  );

  const decide = useCallback(
    (approvalId: string, decision: AcpPermissionDecision): void => {
      const approval = approvals.find((a) => a.approvalId === approvalId);
      if (approval?.source === 'acp') {
        answerAcp(approvalId, decision);
        return;
      }
      if (decision === 'allow_always' && approval?.rule) addRule.mutate(approval.rule);
      addToolApprovalResponse({ id: approvalId, approved: decision !== 'reject_once' });
    },
    [approvals, answerAcp, addRule.mutate, addToolApprovalResponse],
  );

  return {
    approvals,
    onApprove: useCallback((id: string) => decide(id, 'allow_once'), [decide]),
    onAlways: useCallback((id: string) => decide(id, 'allow_always'), [decide]),
    onDeny: useCallback((id: string) => decide(id, 'reject_once'), [decide]),
  };
}
