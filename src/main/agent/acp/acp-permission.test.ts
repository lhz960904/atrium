import { expect, test } from 'bun:test';
import type { PermissionOption, RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { AtriumUIMessage } from '@shared/chat';
import type { InferUIMessageChunk } from 'ai';
import { makeAcpOnPermission } from './acp-permission';
import { describeAcpToolCall } from './describe';
import { AcpPermissionBroker } from './permission-broker';

type Chunk = InferUIMessageChunk<AtriumUIMessage>;
type PermissionChunk = Extract<Chunk, { type: 'data-permissionRequest' }>;

const opt = (kind: PermissionOption['kind'], optionId: string): PermissionOption => ({
  kind,
  optionId,
  name: optionId,
});

const bashRequest = (options: PermissionOption[]): RequestPermissionRequest => ({
  sessionId: 'sess',
  options,
  toolCall: {
    toolCallId: 'call-1',
    kind: 'execute',
    title: 'Run command',
    rawInput: { command: 'curl https://example.com' },
  },
});

function harness(mode: 'default' | 'auto-review' | 'full-access') {
  const broker = new AcpPermissionBroker();
  const written: Chunk[] = [];
  const onPermission = makeAcpOnPermission({
    threadId: 't1',
    mode,
    broker,
    write: (chunk) => written.push(chunk),
  });
  return { broker, written, onPermission };
}

test('full-access auto-allows (preferring allow_always) and emits nothing', async () => {
  const { written, onPermission } = harness('full-access');
  const res = await onPermission(
    bashRequest([opt('allow_once', 'once'), opt('allow_always', 'always')]),
  );
  expect(res).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } });
  expect(written.length).toBe(0);
});

test('default mode emits the permission data part and parks until resolved', async () => {
  const { broker, written, onPermission } = harness('default');
  const pending = onPermission(bashRequest([opt('allow_once', 'once'), opt('reject_once', 'no')]));

  // The ask reached the stream, carrying what the card needs.
  expect(written.length).toBe(1);
  const part = written[0] as PermissionChunk;
  expect(part.type).toBe('data-permissionRequest');
  expect(part.transient).toBe(true);
  expect(part.data.target).toBe('curl https://example.com');
  expect(part.data.prefix).toBe('$ ');
  expect(part.data.canAlways).toBe(false);

  // Still parked: the promise must not settle before the user answers.
  const sentinel = Symbol('pending');
  expect(await Promise.race([pending, Promise.resolve(sentinel)])).toBe(sentinel);

  broker.resolve(part.data.requestId, 'allow_once');
  expect(await pending).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } });

  // Settlement emits the receipt that nets out the replayed ask after a reload.
  expect(written.length).toBe(2);
  expect(written[1]).toEqual({
    type: 'data-permissionResolved',
    data: { requestId: part.data.requestId },
    transient: true,
  });
});

test('canAlways reflects an offered allow_always option', async () => {
  const { broker, written, onPermission } = harness('default');
  const pending = onPermission(
    bashRequest([opt('allow_once', 'once'), opt('allow_always', 'always')]),
  );
  const part = written[0] as PermissionChunk;
  expect(part.data.canAlways).toBe(true);
  broker.resolve(part.data.requestId, 'allow_always');
  expect(await pending).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } });
});

test('cancelThread settles a parked ask as cancelled (stop/abort path)', async () => {
  const { broker, written, onPermission } = harness('default');
  const pending = onPermission(bashRequest([opt('allow_once', 'once')]));
  broker.cancelThread('t1');
  expect(await pending).toEqual({ outcome: { outcome: 'cancelled' } });
  // Cancellation is a settlement too — the receipt still goes out.
  expect(written.at(-1)?.type).toBe('data-permissionResolved');
});

test('describe: execute → $ command, edit → ✎ path, unknown → bare title', () => {
  expect(
    describeAcpToolCall({
      toolCallId: 'c1',
      kind: 'execute',
      rawInput: { command: 'npm test' },
    }),
  ).toEqual({ title: 'execute', target: 'npm test', prefix: '$ ' });

  expect(
    describeAcpToolCall({
      toolCallId: 'c2',
      kind: 'edit',
      title: 'Edit config',
      rawInput: { path: '/ws/a.ts' },
    }),
  ).toEqual({ title: 'Edit config', target: '/ws/a.ts', prefix: '✎ ' });

  // Path can also arrive via locations or file_path.
  expect(
    describeAcpToolCall({
      toolCallId: 'c3',
      kind: 'delete',
      title: 'Delete',
      locations: [{ path: '/ws/b.ts' }],
    }).target,
  ).toBe('/ws/b.ts');

  expect(describeAcpToolCall({ toolCallId: 'c4', kind: 'fetch', title: 'Fetch docs' })).toEqual({
    title: 'Fetch docs',
    target: 'Fetch docs',
    prefix: '',
  });
});
