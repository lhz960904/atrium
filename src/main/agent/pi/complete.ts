import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

/**
 * One question, one answer, no tools — the shape every side call the agent
 * makes happens to have: the compaction summary, the thread title, the
 * auto-review verdict. They all go through the turn's own stream rather than a
 * second, non-streaming client: the provider is already known to work for it,
 * and one code path means one place for a provider quirk to be handled.
 */
export type Complete = (input: {
  system: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<string>;

export type CompleteDeps = {
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey: (provider: string) => string | undefined;
};

export function createCompleter(deps: CompleteDeps): Complete {
  return async ({ system, prompt, signal }) => {
    const stream = await deps.streamFn(
      deps.model,
      {
        systemPrompt: system,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
      { apiKey: deps.getApiKey(deps.model.provider), signal },
    );
    const message = await stream.result();
    if (message.stopReason === 'error' || message.stopReason === 'aborted') {
      throw new Error(message.errorMessage ?? `call ${message.stopReason}`);
    }
    return message.content
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim();
  };
}
