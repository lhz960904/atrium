import { expect, test } from 'bun:test';
import { type AgentMessage, createCompactionSummaryMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message, Usage } from '@shared/protocol';
import {
  compactForTurn,
  type Fold,
  foldHistory,
  pickRecentTail,
  pickRecentWindow,
  renderTranscript,
  withinTurnFold,
} from './compaction';
import type { Summarize } from './summarize';

const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 });

const assistant = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'p',
  model: 'm',
  usage: zeroUsage,
  stopReason: 'stop',
  timestamp: 0,
});

const call = (id: string, name = 'read'): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: { path: id } }],
    api: 'anthropic-messages',
    provider: 'p',
    model: 'm',
    usage: zeroUsage,
    stopReason: 'toolUse',
    timestamp: 0,
  }) as unknown as Message;

const result = (id: string, text: string, name = 'read'): Message =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 0,
  }) as unknown as Message;

const textOf = (message: Message | undefined): string => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content as { type: string; text?: string }[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
};

const summarizer =
  (capture?: (transcript: string) => void): Summarize =>
  async (transcript) => {
    capture?.(transcript);
    return 'SUMMARY';
  };

const failingSummarize: Summarize = async () => {
  throw new Error('boom');
};

// ── window selection ────────────────────────────────────────────────────────

test('the checkpoint window walks the cut back to a user turn', () => {
  const messages = [user('a'), assistant('b'), user('c'), assistant('d'), assistant('e')];
  const kept = pickRecentWindow(messages, { keepRecentTokens: 1, minKeepMessages: 1 });
  expect(kept.map((m) => textOf(m))).toEqual(['c', 'd', 'e']);
});

test('a window at or under the floor keeps everything', () => {
  const messages = [user('a'), assistant('b')];
  expect(pickRecentWindow(messages, { keepRecentTokens: 999, minKeepMessages: 4 })).toHaveLength(2);
});

test('the within-turn window never opens on an orphan tool result', () => {
  const messages = [user('go'), call('c1'), result('c1', 'out'), call('c2'), result('c2', 'out')];
  const kept = pickRecentTail(messages, { keepRecentTokens: 1, minKeepMessages: 1 });
  expect(kept[0].role).toBe('assistant');
  expect(kept).toHaveLength(2);
});

// ── transcript rendering ────────────────────────────────────────────────────

test('the transcript labels roles and renders tool calls and results', () => {
  const out = renderTranscript([user('do it'), call('c1', 'bash'), result('c1', 'done', 'bash')]);
  expect(out).toContain('## user\ndo it');
  expect(out).toContain('[tool bash] {"path":"c1"}');
  expect(out).toContain('[tool result bash] done');
});

test('inline images are reduced to a count, never sent to the summarizer', () => {
  const shot = {
    role: 'toolResult',
    toolCallId: '1',
    toolName: 'screenshot',
    content: [
      { type: 'text', text: 'state' },
      { type: 'image', data: 'A'.repeat(50_000), mimeType: 'image/png' },
    ],
    isError: false,
    timestamp: 0,
  } as unknown as Message;
  const out = renderTranscript([shot]);
  expect(out).toContain('[1 image(s) omitted]');
  expect(out).not.toContain('AAAA');
});

// ── the cross-turn fold ─────────────────────────────────────────────────────

const longHistory = (): Message[] => [
  user('a'),
  assistant('b'),
  user('c'),
  assistant('d'),
  user('e'),
  assistant('f'),
];

function runFold(messages: Message[], over: Partial<Parameters<typeof compactForTurn>[0]> = {}) {
  const persisted: Fold[] = [];
  const phases: string[] = [];
  return {
    persisted,
    phases,
    run: () =>
      compactForTurn({
        messages,
        summarize: summarizer(),
        // Tiny window so the six-message history clears the 0.8 trigger.
        contextWindow: 5,
        keepRecentTokens: 1,
        minKeepMessages: 2,
        emit: (phase) => phases.push(phase),
        persist: (fold) => {
          persisted.push(fold);
        },
        ...over,
      }),
  };
}

test('under the threshold nothing is summarized or stored', async () => {
  const { persisted, phases, run } = runFold([user('hi')], { contextWindow: 100_000 });
  const out = await run();
  expect(persisted).toHaveLength(0);
  expect(phases).toEqual([]);
  expect(out.map(textOf)).toEqual(['hi']);
});

test('over the threshold the summary replaces the folded prefix', async () => {
  const messages = longHistory();
  const { persisted, phases, run } = runFold(messages);
  const out = await run();

  expect(persisted).toHaveLength(1);
  expect(persisted[0].summary).toContain('SUMMARY');
  // Only the recent window is kept verbatim, never folded away.
  expect(persisted[0].retainedTail.map(textOf)).toEqual(['e', 'f']);
  expect(persisted[0].tokensBefore).toBeGreaterThan(0);

  // The turn runs on the same view a later read rebuilds from the stored fold:
  // the summary standing in for the prefix, then the window.
  expect(out).toHaveLength(3);
  expect(out[0]).toMatchObject({ role: 'compactionSummary', summary: persisted[0].summary });
  expect(out.slice(1).map(textOf)).toEqual(['e', 'f']);
  expect(phases).toEqual(['start', 'done']);
});

test('a failed summary leaves the transcript whole and stores nothing', async () => {
  const messages = longHistory();
  const { persisted, phases, run } = runFold(messages, { summarize: failingSummarize });
  const out = await run();
  expect(persisted).toHaveLength(0);
  expect(out).toBe(messages);
  expect(phases).toEqual(['start', 'done']);
});

test('preserver output rides along with the summary', async () => {
  const { persisted, run } = runFold(longHistory(), { preservers: [() => 'CARRIED-PLAN'] });
  await run();
  expect(persisted[0].summary).toContain('CARRIED-PLAN');
});

// ── the within-turn fold ────────────────────────────────────────────────────

const asPi = (messages: Message[]): AgentMessage[] => messages as unknown as AgentMessage[];
const asStored = (messages: AgentMessage[]): Message[] => messages as unknown as Message[];

test('a loop under the threshold passes through untouched', async () => {
  const fold = withinTurnFold({ summarize: summarizer(), contextWindow: 100_000 });
  const messages = [user('go'), call('c1'), result('c1', 'out')];
  expect(asStored(await fold(asPi(messages)))).toEqual(messages);
});

test('a ballooning loop folds into one summary plus the live tail', async () => {
  const fold = withinTurnFold({
    summarize: summarizer(),
    contextWindow: 10,
    keepRecentTokens: 1,
    minKeepMessages: 2,
  });
  const messages = [user('go'), call('c1'), result('c1', 'a'), call('c2'), result('c2', 'b')];
  const out = asStored(await fold(asPi(messages)));

  expect(out[0].role).toBe('user');
  expect(textOf(out[0])).toContain('SUMMARY');
  expect(out).toHaveLength(3);
  expect(out.at(-1)?.role).toBe('toolResult');
});

test('the standing overhead counts toward the threshold', async () => {
  const messages = [user('go'), call('c1'), result('c1', 'a'), call('c2'), result('c2', 'b')];
  const under = withinTurnFold({ summarize: summarizer(), contextWindow: 1000 });
  expect(asStored(await under(asPi(messages)))).toEqual(messages);

  const over = withinTurnFold({
    summarize: summarizer(),
    contextWindow: 1000,
    overheadTokens: 900,
    keepRecentTokens: 1,
    minKeepMessages: 2,
  });
  expect(textOf(asStored(await over(asPi(messages)))[0])).toContain('SUMMARY');
});

test('a later request rebuilds from the remembered fold instead of re-summarizing', async () => {
  let calls = 0;
  const summarize = summarizer(() => {
    calls++;
  });
  const fold = withinTurnFold({
    summarize,
    contextWindow: 60,
    keepRecentTokens: 1,
    minKeepMessages: 2,
  });
  // One oversized result trips the fold; what stays behind fits comfortably.
  const messages = [
    user('go'),
    call('c1'),
    result('c1', 'x'.repeat(400)),
    call('c2'),
    result('c2', 'b'),
  ];
  const first = asStored(await fold(asPi(messages)));
  const second = asStored(await fold(asPi([...messages, call('c3'), result('c3', 'c')])));

  // Same summary object reused; only the live tail grew.
  expect(second[0]).toBe(first[0]);
  expect(calls).toBe(1);
  expect(second).toHaveLength(first.length + 2);
  expect(second.at(-1)?.role).toBe('toolResult');
});

test('a failed within-turn summary runs the request on the view it had', async () => {
  const fold = withinTurnFold({
    summarize: failingSummarize,
    contextWindow: 10,
    keepRecentTokens: 1,
    minKeepMessages: 2,
  });
  const messages = [user('go'), call('c1'), result('c1', 'a'), call('c2'), result('c2', 'b')];
  expect(asStored(await fold(asPi(messages)))).toEqual(messages);
});

test('re-folds a transcript that already carries a compaction summary', async () => {
  // Compacting twice is ordinary: the standing summary is part of the history
  // the second fold reads, and it holds its text outside `content`.
  const summary = createCompactionSummaryMessage('earlier fold', 9, 0) as unknown as Message;
  const history = [summary, ...Array.from({ length: 8 }, (_, i) => user(`turn ${i}`.repeat(200)))];

  const folded = await foldHistory({
    messages: history,
    summarize: async () => 'second summary',
    contextWindow: 1000,
    keepRecentTokens: 0,
  });

  expect(folded).not.toBeNull();
  expect(folded?.summary).toBe('second summary');
  expect(folded?.tokensBefore).toBeGreaterThan(0);
});
