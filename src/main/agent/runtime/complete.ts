import type { Api, Model, Usage } from '@earendil-works/pi-ai';
import { piModels } from '../providers/registry';

/** The text a call produced and what it cost, so no caller has to ask twice. */
export type Completion = { text: string; usage: Usage };

/**
 * One model request, no Agent or tool loop; pi owns provider dispatch and
 * credentials.
 *
 * A call that fails reports nothing: its tokens were still billed, and that
 * spend goes unrecorded on purpose — a failed side call is rare enough that
 * carrying its usage out through a throw costs more than the error is worth.
 */
export async function complete({
  model,
  system,
  prompt,
  signal,
}: {
  model: Model<Api>;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<Completion> {
  signal?.throwIfAborted();
  const message = await piModels.completeSimple(
    model,
    {
      systemPrompt: system,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      tools: [],
    },
    { signal },
  );
  signal?.throwIfAborted();
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(message.errorMessage ?? `call ${message.stopReason}`);
  }
  return {
    text: message.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim(),
    usage: message.usage,
  };
}
