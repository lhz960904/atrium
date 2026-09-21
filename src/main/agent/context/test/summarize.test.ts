import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Usage } from '@earendil-works/pi-ai';
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import { piModels } from '../../providers/registry';

afterEach(() => mock.restore());

import { createSummarizer, SUMMARY_SYSTEM } from '../summarize';

const MODEL = {
  id: 'm1',
  provider: 'p1',
  api: 'anthropic-messages',
} as unknown as Model<'anthropic-messages'>;

const reply = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text: '  SUMMARY  ' }],
    api: 'anthropic-messages',
    provider: 'p1',
    model: 'm1',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
    ...over,
  }) as AssistantMessage;

function answering(
  message: AssistantMessage,
  capture?: (c: Context, key?: string) => void,
): StreamFn {
  return (_model, context, options) => {
    capture?.(context, options?.apiKey);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        stream.push({ type: 'error', reason: message.stopReason, error: message });
      } else {
        stream.push({
          type: 'done',
          reason: message.stopReason === 'pending' ? 'stop' : message.stopReason,
          message,
        });
      }
      stream.end(message);
    });
    return stream;
  };
}

const summarizerWith = (streamFn: StreamFn, onUsage?: (usage: Usage) => void) => {
  spyOn(piModels, 'completeSimple').mockImplementation(async (model, context, options) =>
    (await streamFn(model, context, options)).result(),
  );
  return createSummarizer(MODEL, onUsage);
};

test('sends the transcript as one prompt and returns the trimmed text', async () => {
  let seen: Context | undefined;
  let key: string | undefined;
  const summarize = summarizerWith(
    answering(reply(), (c, k) => {
      seen = c;
      key = k;
    }),
  );
  expect(await summarize('## user\nhello')).toBe('SUMMARY');
  expect(seen?.systemPrompt).toBe(SUMMARY_SYSTEM);
  expect(seen?.messages).toHaveLength(1);
  expect(JSON.stringify(seen?.messages[0].content)).toContain('## user\\nhello');
  // No tools: a summary must never trigger a call.
  expect(seen?.tools).toEqual([]);
  // Credentials come from the engine's store, never handed over per call.
  expect(key).toBeUndefined();
});

test('joins every text block the model produced', async () => {
  const summarize = summarizerWith(
    answering(
      reply({
        content: [
          { type: 'text', text: 'one' },
          { type: 'thinking', thinking: 'ignored' },
          { type: 'text', text: 'two' },
        ],
      }),
    ),
  );
  expect(await summarize('x')).toBe('one\ntwo');
});

test('a failed stream throws so the caller can proceed uncompacted', async () => {
  const summarize = summarizerWith(
    answering(reply({ stopReason: 'error', errorMessage: 'provider said no' })),
  );
  await expect(summarize('x')).rejects.toThrow('provider said no');
});

test('an aborted stream throws too', async () => {
  const summarize = summarizerWith(answering(reply({ stopReason: 'aborted' })));
  await expect(summarize('x')).rejects.toThrow('aborted');
});

test('a summary reports what compacting cost', async () => {
  const spent: number[] = [];
  // Compaction is the one model call the user never asked for, so it is the
  // easiest spend to lose track of.
  const summarize = summarizerWith(answering(reply()), (usage) => spent.push(usage.totalTokens));
  await summarize('## user\nhello');
  expect(spent).toHaveLength(1);
});
