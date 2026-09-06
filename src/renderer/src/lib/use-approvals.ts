import type { AtriumUIMessage } from '@shared/chat';
import { useCallback, useMemo } from 'react';
import { getPendingApprovals, type PendingApproval } from './approvals';
import { trpc } from './trpc';

type UseApprovalsOptions = {
  messages: AtriumUIMessage[];
  /** Answering ends the turn; the chat then auto-resumes. */
  addToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
};

/**
 * The thread's pending approvals and their decision handlers. A paused call
 * lives in the messages as an approval-requested part; answering it ends the
 * turn and the chat auto-resumes, and "always" also persists a trust rule.
 */
export function useApprovals({ messages, addToolApprovalResponse }: UseApprovalsOptions): {
  approvals: PendingApproval[];
  onApprove: (approvalId: string) => void;
  onAlways: (approvalId: string) => void;
  onDeny: (approvalId: string) => void;
} {
  const addRule = trpc.settings.addTrustRule.useMutation();

  const approvals = useMemo(() => getPendingApprovals(messages), [messages]);

  const decide = useCallback(
    (approvalId: string, decision: 'allow_once' | 'allow_always' | 'reject_once'): void => {
      const approval = approvals.find((a) => a.approvalId === approvalId);
      if (decision === 'allow_always' && approval?.rule) addRule.mutate(approval.rule);
      addToolApprovalResponse({ id: approvalId, approved: decision !== 'reject_once' });
    },
    [approvals, addRule.mutate, addToolApprovalResponse],
  );

  return {
    approvals,
    onApprove: useCallback((id: string) => decide(id, 'allow_once'), [decide]),
    onAlways: useCallback((id: string) => decide(id, 'allow_always'), [decide]),
    onDeny: useCallback((id: string) => decide(id, 'reject_once'), [decide]),
  };
}
