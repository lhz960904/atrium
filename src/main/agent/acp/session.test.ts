import { expect, test } from 'bun:test';
import {
  type Agent,
  AgentSideConnection,
  type RequestPermissionRequest,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk';
import { AcpSession } from './session';

/** Cross-wire two in-memory object streams so a ClientSideConnection and an
 *  AgentSideConnection can talk with no subprocess and no JSON framing. */
function pairedStreams(): [Stream, Stream] {
  const c2a = new TransformStream();
  const a2c = new TransformStream();
  return [
    { writable: c2a.writable, readable: a2c.readable },
    { writable: a2c.writable, readable: c2a.readable },
  ];
}

/** Build a fake ACP agent whose prompt() drives `script(conn)` then ends the turn. */
function fakeAgentSession(
  agentStream: Stream,
  script: (conn: AgentSideConnection, sessionId: string) => Promise<void>,
): void {
  let conn: AgentSideConnection;
  const agent: Agent = {
    async initialize(p) {
      return { protocolVersion: p.protocolVersion, agentCapabilities: {}, authMethods: [] };
    },
    async newSession() {
      return { sessionId: 'sess_1' };
    },
    async authenticate() {
      return {};
    },
    async prompt(p) {
      await script(conn, p.sessionId);
      return { stopReason: 'end_turn' };
    },
    async cancel() {},
  };
  conn = new AgentSideConnection(() => agent, agentStream);
}

test('handshake opens a session and prompt forwards updates + stop reason', async () => {
  const [clientStream, agentStream] = pairedStreams();
  fakeAgentSession(agentStream, async (conn, sessionId) => {
    await conn.sessionUpdate({
      sessionId,
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } },
    });
    await conn.sessionUpdate({
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });
  });

  const session = new AcpSession(clientStream);
  const { sessionId } = await session.start('/ws');
  expect(sessionId).toBe('sess_1');

  const updates: SessionNotification['update'][] = [];
  const stop = await session.prompt([{ type: 'text', text: 'hi' }], {
    onUpdate: (u) => updates.push(u),
    onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  });
  expect(stop).toBe('end_turn');
  expect(updates.map((u) => u.sessionUpdate)).toEqual([
    'agent_thought_chunk',
    'agent_message_chunk',
  ]);
});

test('forwards a permission request to the current turn handler', async () => {
  const [clientStream, agentStream] = pairedStreams();
  fakeAgentSession(agentStream, async (conn, sessionId) => {
    await conn.requestPermission({
      sessionId,
      toolCall: { toolCallId: 'tc_1', title: 'Edit file' },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
      ],
    });
  });

  // An array, not a nullable let: control-flow analysis can't see the closure
  // assignment and would pin a let to its initial null at the assertions below.
  const granted: RequestPermissionRequest[] = [];
  const session = new AcpSession(clientStream);
  await session.start('/ws');
  await session.prompt([{ type: 'text', text: 'edit it' }], {
    onUpdate: () => {},
    onPermission: async (req) => {
      granted.push(req);
      return { outcome: { outcome: 'selected', optionId: 'allow' } };
    },
  });

  expect(granted.length).toBe(1);
  expect(granted[0].toolCall.title).toBe('Edit file');
});

test('resume uses session/load when the agent supports it', async () => {
  const [clientStream, agentStream] = pairedStreams();
  const loaded: string[] = [];
  const agent: Agent = {
    async initialize(p) {
      return {
        protocolVersion: p.protocolVersion,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      };
    },
    async newSession() {
      return { sessionId: 'fresh' };
    },
    async loadSession(p) {
      loaded.push(p.sessionId);
      return {};
    },
    async authenticate() {
      return {};
    },
    async prompt() {
      return { stopReason: 'end_turn' };
    },
    async cancel() {},
  };
  new AgentSideConnection(() => agent, agentStream);

  const session = new AcpSession(clientStream);
  const { sessionId } = await session.start('/ws', 'prior-1');
  expect(loaded).toEqual(['prior-1']); // loaded the prior session, not a fresh one
  expect(sessionId).toBe('prior-1');
});

test('reuses one session across multiple prompt turns', async () => {
  const [clientStream, agentStream] = pairedStreams();
  let prompts = 0;
  fakeAgentSession(agentStream, async (conn, sessionId) => {
    prompts += 1;
    await conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `turn ${prompts}` },
      },
    });
  });

  const session = new AcpSession(clientStream);
  await session.start('/ws');

  const seen: string[] = [];
  const handlers = {
    onUpdate: (u: SessionNotification['update']) => {
      if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text')
        seen.push(u.content.text);
    },
    onPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
  };
  await session.prompt([{ type: 'text', text: 'a' }], handlers);
  await session.prompt([{ type: 'text', text: 'b' }], handlers);

  // Two turns, one session (newSession was called once — see the fake agent).
  expect(seen).toEqual(['turn 1', 'turn 2']);
});

test('start() rejects (does not crash) when the adapter binary is missing', async () => {
  const session = AcpSession.spawn('atrium-nonexistent-acp-xyz', [], '/tmp');
  await expect(session.start('/tmp')).rejects.toThrow(/not found/);
});
