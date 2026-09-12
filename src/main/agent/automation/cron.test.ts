import { expect, test } from 'bun:test';
import { computeNextRun, cronPattern, isRecurringCron, isValidCron } from './cron';

test('isValidCron accepts a 5-field pattern and rejects garbage', () => {
  expect(isValidCron('0 9 * * *')).toBe(true);
  expect(isValidCron('0 8 * * 1-5')).toBe(true);
  expect(isValidCron('not a cron')).toBe(false);
  expect(isValidCron('')).toBe(false);
});

test('isRecurringCron requires exactly 5 valid fields (minute floor)', () => {
  expect(isRecurringCron('0 8 * * 1-5')).toBe(true);
  expect(isRecurringCron('  0 8 * * 1-5  ')).toBe(true);
  // 6-field (with seconds) would allow sub-minute firing → rejected.
  expect(isRecurringCron('*/30 * * * * *')).toBe(false);
  expect(isRecurringCron('0 8 * *')).toBe(false);
  expect(isRecurringCron('nonsense')).toBe(false);
});

test('computeNextRun: recurring resolves the next occurrence in the given timezone', () => {
  const before = computeNextRun(
    { kind: 'recurring', cronExpr: '0 9 * * *', runAt: null, timezone: 'UTC' },
    new Date('2026-07-01T08:00:00Z'),
  );
  expect(before?.toISOString()).toBe('2026-07-01T09:00:00.000Z');

  const after = computeNextRun(
    { kind: 'recurring', cronExpr: '0 9 * * *', runAt: null, timezone: 'UTC' },
    new Date('2026-07-01T10:00:00Z'),
  );
  expect(after?.toISOString()).toBe('2026-07-02T09:00:00.000Z');
});

test('computeNextRun: once returns runAt only while it is still in the future', () => {
  const runAt = new Date('2026-07-01T09:00:00Z');
  expect(
    computeNextRun(
      { kind: 'once', cronExpr: null, runAt, timezone: 'UTC' },
      new Date('2026-07-01T08:00:00Z'),
    )?.toISOString(),
  ).toBe('2026-07-01T09:00:00.000Z');
  expect(
    computeNextRun(
      { kind: 'once', cronExpr: null, runAt, timezone: 'UTC' },
      new Date('2026-07-01T10:00:00Z'),
    ),
  ).toBeNull();
});

test('computeNextRun returns null for a malformed recurring pattern', () => {
  expect(
    computeNextRun(
      { kind: 'recurring', cronExpr: 'bogus', runAt: null, timezone: 'UTC' },
      new Date(),
    ),
  ).toBeNull();
});

test('cronPattern builders emit the expected 5-field strings', () => {
  expect(cronPattern.everyDayAt(9, 30)).toBe('30 9 * * *');
  expect(cronPattern.everyWeekdayAt(8, 0)).toBe('0 8 * * 1-5');
  expect(cronPattern.everyWeekAt(1, 9, 0)).toBe('0 9 * * 1');
  expect(cronPattern.everyMonthAt(15, 9, 0)).toBe('0 9 15 * *');
  expect(cronPattern.everyHour()).toBe('0 * * * *');
});
