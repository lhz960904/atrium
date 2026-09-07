import { expect, test } from 'bun:test';
import { applyCheckpoint, type MessageRow } from '../persist';

const row = (id: string, metadata?: Record<string, unknown>): MessageRow =>
  ({ id, role: 'user', parts: {}, metadata: metadata ?? null }) as unknown as MessageRow;

const ids = (rows: MessageRow[]) => rows.map((r) => r.id);

test('no checkpoint leaves the rows alone', () => {
  const rows = [row('u1'), row('a1')];
  expect(applyCheckpoint(rows)).toBe(rows);
});

/**
 * The pair is written with the current timestamp, so it sorts after the very
 * rows it should precede. Rebuilding has to recover them by id.
 */
test('the fold is rebuilt by id, not by stored order', () => {
  const rows = [
    row('u1'),
    row('a1'),
    row('u2'),
    row('a2'),
    row('u3'),
    row('sum', { kind: 'compaction', coveredThroughId: 'u2' }),
    row('ack', { kind: 'compaction-ack' }),
    row('a3'),
  ];
  expect(ids(applyCheckpoint(rows))).toEqual(['sum', 'ack', 'a2', 'u3', 'a3']);
});

test('an older checkpoint pair is dropped from the kept tail', () => {
  const rows = [
    row('u1'),
    row('sum1', { kind: 'compaction', coveredThroughId: 'u1' }),
    row('ack1', { kind: 'compaction-ack' }),
    row('u2'),
    row('a2'),
    row('sum2', { kind: 'compaction', coveredThroughId: 'u2' }),
    row('ack2', { kind: 'compaction-ack' }),
  ];
  expect(ids(applyCheckpoint(rows))).toEqual(['sum2', 'ack2', 'a2']);
});

test('a checkpoint whose covered row is gone falls back to its own position', () => {
  const rows = [
    row('u1'),
    row('sum', { kind: 'compaction', coveredThroughId: 'deleted' }),
    row('ack', { kind: 'compaction-ack' }),
    row('a3'),
  ];
  expect(ids(applyCheckpoint(rows))).toEqual(['sum', 'ack', 'a3']);
});
