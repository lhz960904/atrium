import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import {
  createModels,
  envApiKeyAuth,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai';
import { piModels } from '../../providers/registry';
import { complete as runComplete } from '../complete';

afterEach(() => mock.restore());

import * as completionModule from '../complete';

test('completion is a direct function without a factory', () => {
  expect(completionModule).toHaveProperty('complete', expect.any(Function));
  expect(completionModule).not.toHaveProperty('createCompleter');
});

function fixture() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  spyOn(piModels, 'completeSimple').mockImplementation(models.completeSimple.bind(models));
  return {
    faux,
    complete: (input: Omit<Parameters<typeof runComplete>[0], 'model'>) =>
      runComplete({ ...input, model: faux.getModel() }),
  };
}

test('completeSimple resolves the provider credential through its Models store', async () => {
  const faux = fauxProvider();
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({
    type: 'api_key',
    key: 'test-only-key',
  }));
  const models = createModels({ credentials });
  models.setProvider({ ...faux.provider, auth: { apiKey: envApiKeyAuth('Test', []) } });
  faux.setResponses([
    (_context, options) => {
      expect(options?.apiKey).toBe('test-only-key');
      return fauxAssistantMessage('ok');
    },
  ]);
  spyOn(piModels, 'completeSimple').mockImplementation(models.completeSimple.bind(models));
  expect(await runComplete({ model: faux.getModel(), system: '', prompt: 'x' })).toBe('ok');
});

test('one tool-free request returns only trimmed text blocks', async () => {
  const { faux, complete } = fixture();
  faux.setResponses([
    (context) => {
      expect(context.systemPrompt).toBe('system');
      expect(context.messages).toHaveLength(1);
      expect(context.messages[0].content).toBe('prompt');
      expect(context.tools).toEqual([]);
      return fauxAssistantMessage([
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: ' one' },
        { type: 'text', text: 'two ' },
      ]);
    },
  ]);
  expect(await complete({ system: 'system', prompt: 'prompt' })).toBe('one\ntwo');
  expect(faux.state.callCount).toBe(1);
});

test.each(['error', 'aborted'] as const)('%s results are rejected', async (stopReason) => {
  const { faux, complete } = fixture();
  faux.setResponses([fauxAssistantMessage('', { stopReason, errorMessage: 'request failed' })]);
  await expect(complete({ system: '', prompt: 'x' })).rejects.toThrow('request failed');
});

test('a provider tool call does not start another request or execute tools', async () => {
  const { faux, complete } = fixture();
  faux.setResponses([
    fauxAssistantMessage([{ type: 'toolCall', id: 'call-1', name: 'unknown', arguments: {} }], {
      stopReason: 'toolUse',
    }),
  ]);
  expect(await complete({ system: '', prompt: 'x' })).toBe('');
  expect(faux.state.callCount).toBe(1);
});

test('pre-aborted requests never reach the provider', async () => {
  const { faux, complete } = fixture();
  await expect(
    complete({ system: '', prompt: 'x', signal: AbortSignal.abort(new Error('cancelled')) }),
  ).rejects.toThrow('cancelled');
  expect(faux.state.callCount).toBe(0);
});

test('active cancellation reaches pi-ai and rejects completion', async () => {
  const { faux, complete } = fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  faux.setResponses([
    (_context, options) =>
      new Promise((resolve) => {
        options?.signal?.addEventListener(
          'abort',
          () => resolve(fauxAssistantMessage('', { stopReason: 'aborted' })),
          { once: true },
        );
        started();
      }),
  ]);
  const abort = new AbortController();
  const pending = complete({ system: '', prompt: 'x', signal: abort.signal });
  await ready;
  abort.abort(new Error('cancelled'));
  await expect(pending).rejects.toThrow('cancelled');
});

test('separate calls do not accumulate conversation history', async () => {
  const { faux, complete } = fixture();
  faux.setResponses([
    (context) => {
      expect(context.messages).toHaveLength(1);
      return fauxAssistantMessage('ok');
    },
  ]);
  expect(await complete({ system: '', prompt: 'first' })).toBe('ok');
  faux.setResponses([
    (context) => {
      expect(context.messages).toHaveLength(1);
      expect(context.messages[0].content).toBe('second');
      return fauxAssistantMessage('ok');
    },
  ]);
  expect(await complete({ system: '', prompt: 'second' })).toBe('ok');
  expect(faux.state.callCount).toBe(2);
});

test.each(['stop', 'error'] as const)('%s calls report what they spent', async (stopReason) => {
  const { faux, complete } = fixture();
  faux.setResponses([fauxAssistantMessage('ok', { stopReason, errorMessage: 'request failed' })]);
  const spent: number[] = [];

  // A side call that errors still burned tokens, and is exactly the kind of
  // spend nothing else would ever notice — so the report precedes the throw.
  const call = complete({ system: '', prompt: 'x', onUsage: (u) => spent.push(u.totalTokens) });
  if (stopReason === 'error') await expect(call).rejects.toThrow('request failed');
  else await call;

  expect(spent).toHaveLength(1);
});
