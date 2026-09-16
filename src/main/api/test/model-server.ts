/**
 * A deterministic OpenAI-compatible chat endpoint for driving the real app
 * through a custom provider. Run with `bun run src/main/api/test/model-server.ts`:
 * it binds 127.0.0.1 on a random port and prints its base URL. `POST /control`
 * picks what the next turns do, `GET /control` reports how many model requests
 * a flow made. It never proxies anywhere and holds no credentials.
 */

type Scenario = 'approval' | 'batch' | 'clarification' | 'text';

const state = {
  scenario: 'approval' as Scenario,
  /** Where approval turns write: outside the project, inside the test's temp dir. */
  outsidePath: '',
  counts: { turns: 0, titles: 0 },
};

type ChatMessage = { role: string; content?: string | { type: string; text?: string }[] };

const contentOf = (content: ChatMessage['content']): string =>
  typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');

const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
  id: 'chatcmpl-fixture',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'fixture',
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

function sse(chunks: unknown[]): Response {
  const usage = {
    ...chunk({}),
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  };
  const body = `${[...chunks, usage].map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

const text = (value: string) =>
  sse([chunk({ role: 'assistant', content: value }), chunk({}, 'stop')]);

const toolCalls = (calls: { name: string; args: unknown }[]) =>
  sse([
    chunk({
      role: 'assistant',
      tool_calls: calls.map((call, index) => ({
        index,
        id: `call_${state.counts.turns}_${index}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    }),
    chunk({}, 'tool_calls'),
  ]);

const writeOutside = (line: string) => ({
  name: 'write_file',
  args: {
    description: 'Record a marker outside the project',
    path: state.outsidePath,
    content: `${line}\n`,
    append: true,
  },
});

function turn(messages: ChatMessage[]): Response {
  const last = messages.at(-1);
  if (last?.role === 'tool') return text(`The tool said: ${contentOf(last.content)}`);
  switch (state.scenario) {
    case 'approval':
      return toolCalls([writeOutside('approved')]);
    case 'batch':
      return toolCalls([writeOutside('first'), writeOutside('second')]);
    case 'clarification':
      return toolCalls([
        {
          name: 'ask_clarification',
          args: { questions: [{ header: 'Color', question: 'Which color?', inputType: 'text' }] },
        },
      ]);
    case 'text':
      return text('Plain reply.');
  }
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/control') {
      if (request.method === 'POST') Object.assign(state, await request.json());
      return Response.json(state);
    }
    if (url.pathname !== '/v1/chat/completions' || request.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }
    const body = (await request.json()) as { messages: ChatMessage[]; tools?: unknown[] };
    // Title and summary requests carry no tools; they must not disturb a flow's turn count.
    if (!body.tools?.length) {
      state.counts.titles++;
      return text('Fixture chat');
    }
    state.counts.turns++;
    return turn(body.messages);
  },
});

console.info({
  baseUrl: `http://127.0.0.1:${server.port}/v1`,
  control: `http://127.0.0.1:${server.port}/control`,
});
