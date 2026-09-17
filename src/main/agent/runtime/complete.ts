import type { Api, Model } from '@earendil-works/pi-ai';
import { piModels } from '../providers/registry';

/** One model request, no Agent or tool loop; pi owns provider dispatch and credentials. */
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
}): Promise<string> {
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
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim();
}
