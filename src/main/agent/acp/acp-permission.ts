import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { AtriumUIMessage } from '@shared/chat';
import type { PermissionMode } from '@shared/permissions';
import type { InferUIMessageChunk, LanguageModel } from 'ai';
import { reviewBoundaryCrossing } from '../permissions/reviewer';
import { describeAcpToolCall } from './describe';
import type { AcpPermissionBroker } from './permission-broker';

type Deps = {
  threadId: string;
  mode: PermissionMode;
  broker: AcpPermissionBroker;
  /** Reviewer for auto-review mode; absent → auto-review behaves like default. */
  reviewerModel?: LanguageModel;
  /** The turn's abort signal, so a stopped turn also cancels an in-flight review. */
  abortSignal?: AbortSignal;
  // Typed against AtriumUIMessage (not the bare UIMessageChunk, whose data
  // variant degrades to `data-${string}`/unknown) so the emitted payload is
  // checked against the permissionRequest data-part shape.
  write: (chunk: InferUIMessageChunk<AtriumUIMessage>) => void;
};

/**
 * Build a turn's onPermission handler. full-access auto-allows without
 * surfacing anything. In auto-review, the reviewer model judges the agent's ask
 * first — an ALLOW auto-responds with a one-shot allow (no card), anything else
 * falls through to the prompt. Default (and auto-review's fallthrough) streams a
 * transient permissionRequest data part — which shows the approval card — and
 * parks the agent's promise in the broker until the decision arrives on the
 * acp-permission endpoint. The agent classifies its own calls (it only asks for
 * what it considers sensitive), so our static boundary analysis doesn't run; the
 * reviewer judges the operation directly from the agent's tool kind + input.
 */
export function makeAcpOnPermission(deps: Deps) {
  return async (req: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    if (deps.mode === 'full-access') return autoAllow(req, 'always');

    const view = describeAcpToolCall(req.toolCall);

    if (deps.mode === 'auto-review' && deps.reviewerModel) {
      const verdict = await reviewBoundaryCrossing({
        model: deps.reviewerModel,
        subject: view.target,
        abortSignal: deps.abortSignal,
      });
      // Allow once (not always) — the reviewer judges each occurrence, so the
      // agent should keep asking rather than be permanently whitelisted.
      if (verdict === 'allow') return autoAllow(req, 'once');
    }

    const { requestId, response } = deps.broker.request(deps.threadId, req.options);
    deps.write({
      type: 'data-permissionRequest',
      data: {
        requestId,
        toolCallId: req.toolCall.toolCallId,
        title: view.title,
        target: view.target,
        prefix: view.prefix,
        canAlways: req.options.some((o) => o.kind === 'allow_always'),
      },
      transient: true,
    });
    return response.then((res) => {
      // Settlement receipt: a reload replays the stream buffer from the start,
      // so each answered ask needs a matching resolved part or it would come
      // back as a ghost card. Settlement can race the stream closing (turn
      // aborted/agent died), where the write throws — the receipt is just a UI
      // hint, so it's dropped rather than failing the turn.
      try {
        deps.write({ type: 'data-permissionResolved', data: { requestId }, transient: true });
      } catch {}
      return res;
    });
  };
}

/**
 * Auto-respond with an allow. `prefer` picks which when both are offered:
 * full-access wants 'always' (zero friction across the session); a reviewer's
 * per-call approval wants 'once' so the agent keeps asking and each occurrence
 * is judged afresh. Falls back to whatever allow exists, else cancels.
 */
function autoAllow(
  req: RequestPermissionRequest,
  prefer: 'always' | 'once',
): RequestPermissionResponse {
  const first = prefer === 'always' ? 'allow_always' : 'allow_once';
  const second = prefer === 'always' ? 'allow_once' : 'allow_always';
  const allow =
    req.options.find((o) => o.kind === first) ??
    req.options.find((o) => o.kind === second) ??
    req.options[0];
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
