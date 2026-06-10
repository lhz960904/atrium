import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { AtriumUIMessage } from '@shared/chat';
import type { PermissionMode } from '@shared/permissions';
import type { InferUIMessageChunk } from 'ai';
import { describeAcpToolCall } from './describe';
import type { AcpPermissionBroker } from './permission-broker';

type Deps = {
  threadId: string;
  mode: PermissionMode;
  broker: AcpPermissionBroker;
  // Typed against AtriumUIMessage (not the bare UIMessageChunk, whose data
  // variant degrades to `data-${string}`/unknown) so the emitted payload is
  // checked against the permissionRequest data-part shape.
  write: (chunk: InferUIMessageChunk<AtriumUIMessage>) => void;
};

/**
 * Build a turn's onPermission handler. full-access auto-allows without
 * surfacing anything (the agent's ask is answered instantly). Every other mode
 * streams a transient permissionRequest data part to the client — which shows
 * the approval card — and parks the agent's promise in the broker until the
 * decision arrives on the acp-permission endpoint. The agent classifies its
 * own calls (it only asks for what it considers sensitive), so our native
 * boundary analysis doesn't run here.
 */
export function makeAcpOnPermission(deps: Deps) {
  return async (req: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    if (deps.mode === 'full-access') return autoAllow(req);

    const { requestId, response } = deps.broker.request(deps.threadId, req.options);
    const view = describeAcpToolCall(req.toolCall);
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

/** Prefer the persistent allow so full-access threads are asked at most once per kind. */
function autoAllow(req: RequestPermissionRequest): RequestPermissionResponse {
  const allow =
    req.options.find((o) => o.kind === 'allow_always') ??
    req.options.find((o) => o.kind === 'allow_once') ??
    req.options[0];
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
