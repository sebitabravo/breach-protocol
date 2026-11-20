import { describe, expect, it } from 'vitest';
import { dailySeed, utcDateKey } from '../../src/core/daily';

describe('dailySeed', () => {
  it('is the UTC calendar date as a YYYYMMDD integer', () => {
    expect(dailySeed(new Date('2026-11-20T12:00:00Z'))).toBe(20261120);
  });

  it('keeps the leading zeros of month and day', () => {
    expect(dailySeed(new Date('2026-01-05T08:00:00Z'))).toBe(20260105);
  });

  it('rolls over at UTC midnight, including the year boundary', () => {
    expect(dailySeed(new Date('2026-12-31T23:59:59.999Z'))).toBe(20261231);
    expect(dailySeed(new Date('2027-01-01T00:00:00.000Z'))).toBe(20270101);
  });

  it('rolls over into a leap day and out of February', () => {
    expect(dailySeed(new Date('2028-02-28T23:30:00Z'))).toBe(20280228);
    expect(dailySeed(new Date('2028-02-29T00:00:00Z'))).toBe(20280229);
    expect(dailySeed(new Date('2027-02-28T23:59:59Z'))).toBe(20270228);
    expect(dailySeed(new Date('2027-03-01T00:00:00Z'))).toBe(20270301);
  });

  it('does not depend on the local timezone of the instant', () => {
    // 02:00 del 1 de marzo en UTC+5 es el 28 de febrero en UTC.
    expect(dailySeed(new Date('2026-03-01T02:00:00+05:00'))).toBe(20260228);
    // 22:00 del 31 de diciembre en UTC-3 ya es 1 de enero en UTC.
    expect(dailySeed(new Date('2026-12-31T22:00:00-03:00'))).toBe(20270101);
  });
});

describe('utcDateKey', () => {
  it('formats the UTC date as YYYY-MM-DD', () => {
    expect(utcDateKey(new Date('2026-03-01T02:00:00+05:00'))).toBe('2026-02-28');
    expect(utcDateKey(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20');
  });
});
