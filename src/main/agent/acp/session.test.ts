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

test('handshake reports empty auth methods and prompt forwards updates + stop reason', async () => {
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

  const updates: SessionNotification['update'][] = [];
  const session = new AcpSession(clientStream, {
    onUpdate: (u) => updates.push(u),
    onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
  });

  const { authMethods } = await session.start('/ws');
  expect(authMethods).toEqual([]);

  const stop = await session.prompt([{ type: 'text', text: 'hi' }]);
  expect(stop).toBe('end_turn');
  expect(updates.map((u) => u.sessionUpdate)).toEqual([
    'agent_thought_chunk',
    'agent_message_chunk',
  ]);
});

test('forwards a permission request to the handler and returns its outcome', async () => {
  const [clientStream, agentStream] = pairedStreams();
  let granted: RequestPermissionRequest | null = null;
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

  const session = new AcpSession(clientStream, {
    onUpdate: () => {},
    onPermission: async (req) => {
      granted = req;
      return { outcome: { outcome: 'selected', optionId: 'allow' } };
    },
  });
  await session.start('/ws');
  await session.prompt([{ type: 'text', text: 'edit it' }]);

  expect(granted).not.toBeNull();
  expect((granted as RequestPermissionRequest).toolCall.title).toBe('Edit file');
});
