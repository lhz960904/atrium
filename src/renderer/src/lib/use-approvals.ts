import type { AtriumUIMessage } from '@shared/chat';
import { useCallback, useMemo } from 'react';
import { toast } from '../state/toast-store';
import { getPendingApprovals, type PendingApproval } from './approvals';
import { trpc } from './trpc';

type UseApprovalsOptions = {
  messages: AtriumUIMessage[];
  /** Sends the decision to the run waiting on it; rejects when it did not land. */
  addToolApprovalResponse: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => Promise<void>;
};

/**
 * The thread's pending approvals and their decision handlers. A waiting call
 * lives in the messages as an approval-requested part; its decision goes to the
 * run still waiting on it, and "always" first persists a trust rule. A handler
 * rejects when its decision did not land, so the card can offer it again.
 */
export function useApprovals({ messages, addToolApprovalResponse }: UseApprovalsOptions): {
  approvals: PendingApproval[];
  onApprove: (approvalId: string) => Promise<void>;
  onAlways: (approvalId: string) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
} {
  const addRule = trpc.settings.addTrustRule.useMutation();

  const approvals = useMemo(() => getPendingApprovals(messages), [messages]);

  const decide = useCallback(
    async (
      approvalId: string,
      decision: 'allow_once' | 'allow_always' | 'reject_once',
    ): Promise<void> => {
      const approval = approvals.find((a) => a.approvalId === approvalId);
      if (!approval) return;
      try {
        // A rule that failed to save must not turn into an approval.
        if (decision === 'allow_always' && approval.rule) await addRule.mutateAsync(approval.rule);
        await addToolApprovalResponse({ id: approvalId, approved: decision !== 'reject_once' });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    [approvals, addRule.mutateAsync, addToolApprovalResponse],
  );

  return {
    approvals,
    onApprove: useCallback((id: string) => decide(id, 'allow_once'), [decide]),
    onAlways: useCallback((id: string) => decide(id, 'allow_always'), [decide]),
    onDeny: useCallback((id: string) => decide(id, 'reject_once'), [decide]),
  };
}
