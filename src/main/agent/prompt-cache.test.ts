import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import { stampCacheBreakpoints, usesAnthropicPromptCache } from './prompt-cache';

const ephemeral = { anthropic: { cacheControl: { type: 'ephemeral' } } };

test('stamps the last two messages and leaves the rest untouched', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ];
  const stamped = stampCacheBreakpoints(messages);
  expect(stamped[0].providerOptions).toBeUndefined();
  expect(stamped[1].providerOptions).toEqual(ephemeral);
  expect(stamped[2].providerOptions).toEqual(ephemeral);
});

test('handles arrays shorter than the breakpoint count', () => {
  const stamped = stampCacheBreakpoints([{ role: 'user', content: 'only' }]);
  expect(stamped).toHaveLength(1);
  expect(stamped[0].providerOptions).toEqual(ephemeral);
  expect(stampCacheBreakpoints([])).toEqual([]);
});

test('copies stamped messages instead of mutating the originals', () => {
  const original: ModelMessage = { role: 'user', content: 'tail' };
  const stamped = stampCacheBreakpoints([original]);
  expect(original.providerOptions).toBeUndefined();
  expect(stamped[0]).not.toBe(original);
});

test('merges with existing providerOptions rather than replacing them', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: 'tail',
      providerOptions: { anthropic: { sendReasoning: true }, openai: { store: false } },
    },
  ];
  const stamped = stampCacheBreakpoints(messages);
  expect(stamped[0].providerOptions).toEqual({
    anthropic: { sendReasoning: true, cacheControl: { type: 'ephemeral' } },
    openai: { store: false },
  });
});

test('usesAnthropicPromptCache is true only for anthropic-protocol cloud providers', () => {
  expect(usesAnthropicPromptCache('anthropic')).toBe(true);
  expect(usesAnthropicPromptCache('volcengine-agent')).toBe(true);
  expect(usesAnthropicPromptCache('openai')).toBe(false);
  expect(usesAnthropicPromptCache('ollama')).toBe(false);
  expect(usesAnthropicPromptCache('nonexistent')).toBe(false);
  expect(usesAnthropicPromptCache(undefined)).toBe(false);
});
