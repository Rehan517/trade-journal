import { afterEach, describe, expect, it } from 'vitest';
import {
  localInputAtNy,
  monthRange,
  nyDateOf,
  nyMidnightUtc,
  nyToday,
} from './tradingDay.ts';

// The web tsconfig has no Node types; the runtime still has process.
const proc = (
  globalThis as unknown as {
    process: { env: Record<string, string | undefined> };
  }
).process;

describe('nyDateOf', () => {
  it('gives the New York date of a morning instant', () => {
    expect(nyDateOf('2026-10-09T13:45:00Z')).toEqual({
      year: 2026,
      month: 10,
      day: 9,
    }); // 09:45 EDT
  });

  it('keeps a late Friday evening on Friday, though UTC is Saturday', () => {
    expect(nyDateOf('2026-10-10T03:30:00Z')).toEqual({
      year: 2026,
      month: 10,
      day: 9,
    }); // 23:30 EDT
  });

  it('puts a 01:30 Melbourne trade on the previous New York date', () => {
    // 01:30 on the 24th in Melbourne (AEDT, +11) is 14:30Z on the 23rd.
    expect(nyDateOf('2026-11-23T14:30:00Z')).toEqual({
      year: 2026,
      month: 11,
      day: 23,
    });
  });

  it('accepts a Date as well as a string', () => {
    expect(nyDateOf(new Date(Date.UTC(2026, 9, 9, 13, 45)))).toEqual({
      year: 2026,
      month: 10,
      day: 9,
    });
  });

  it('switches date at New York midnight in EDT (04:00Z)', () => {
    expect(nyDateOf('2026-10-01T03:59:59Z')).toEqual({
      year: 2026,
      month: 9,
      day: 30,
    });
    expect(nyDateOf('2026-10-01T04:00:00Z')).toEqual({
      year: 2026,
      month: 10,
      day: 1,
    });
  });

  it('switches date at New York midnight in EST (05:00Z)', () => {
    expect(nyDateOf('2026-12-01T04:59:59Z')).toEqual({
      year: 2026,
      month: 11,
      day: 30,
    });
    expect(nyDateOf('2026-12-01T05:00:00Z')).toEqual({
      year: 2026,
      month: 12,
      day: 1,
    });
  });

  it('rolls over the year', () => {
    expect(nyDateOf('2027-01-01T04:59:59Z')).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
    expect(nyDateOf('2027-01-01T05:00:00Z')).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('handles the 1 Nov fall-back day (a 25 hour day)', () => {
    // 01:30 EDT and 01:30 EST (the repeated hour) are both 1 Nov.
    expect(nyDateOf('2026-11-01T05:30:00Z')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
    expect(nyDateOf('2026-11-01T06:30:00Z')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
    expect(nyDateOf('2026-11-02T04:59:59Z')).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
  });
});

describe('nyMidnightUtc', () => {
  it.each([
    [
      '2026-10-01 (EDT)',
      { year: 2026, month: 10, day: 1 },
      '2026-10-01T04:00:00.000Z',
    ],
    [
      '2026-12-01 (EST)',
      { year: 2026, month: 12, day: 1 },
      '2026-12-01T05:00:00.000Z',
    ],
    [
      '2027-01-01 (year rollover)',
      { year: 2027, month: 1, day: 1 },
      '2027-01-01T05:00:00.000Z',
    ],
    [
      '2026-03-08 (spring forward day, still EST at midnight)',
      { year: 2026, month: 3, day: 8 },
      '2026-03-08T05:00:00.000Z',
    ],
    [
      '2026-03-09 (day after spring forward)',
      { year: 2026, month: 3, day: 9 },
      '2026-03-09T04:00:00.000Z',
    ],
    [
      '2026-11-01 (fall back day, still EDT at midnight)',
      { year: 2026, month: 11, day: 1 },
      '2026-11-01T04:00:00.000Z',
    ],
    [
      '2026-11-02 (day after fall back)',
      { year: 2026, month: 11, day: 2 },
      '2026-11-02T05:00:00.000Z',
    ],
  ])('%s', (_name, date, expected) => {
    expect(nyMidnightUtc(date)).toBe(expected);
  });

  it('round-trips through nyDateOf at the instant and one ms before', () => {
    const date = { year: 2026, month: 11, day: 2 };
    const iso = nyMidnightUtc(date);
    expect(nyDateOf(iso)).toEqual(date);
    expect(nyDateOf(new Date(Date.parse(iso) - 1))).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
  });
});

describe('monthRange', () => {
  it('October 2026 is EDT to EDT', () => {
    expect(monthRange(2026, 10)).toEqual({
      from: '2026-10-01T04:00:00.000Z',
      to: '2026-11-01T04:00:00.000Z',
    });
  });

  it('November 2026 spans the 1 Nov change', () => {
    expect(monthRange(2026, 11)).toEqual({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-12-01T05:00:00.000Z',
    });
  });

  it('December rolls to January of the next year', () => {
    expect(monthRange(2026, 12).to).toBe('2027-01-01T05:00:00.000Z');
    expect(monthRange(2026, 12).from).toBe('2026-12-01T05:00:00.000Z');
  });

  it('March 2026 spans the spring-forward change', () => {
    expect(monthRange(2026, 3)).toEqual({
      from: '2026-03-01T05:00:00.000Z',
      to: '2026-04-01T04:00:00.000Z',
    });
  });

  it('a trade at 03:59:59Z on 1 Nov is inside October, not November', () => {
    const oct = monthRange(2026, 10);
    const nov = monthRange(2026, 11);
    const t = '2026-11-01T03:59:59.000Z';
    expect(t >= oct.from && t < oct.to).toBe(true);
    expect(t >= nov.from).toBe(false);
  });
});

describe('nyToday', () => {
  it('is the New York date at that instant', () => {
    expect(nyToday(new Date('2026-11-24T03:00:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 23,
    });
    expect(nyToday(new Date('2026-11-24T05:00:00Z'))).toEqual({
      year: 2026,
      month: 11,
      day: 24,
    });
  });
});

describe('localInputAtNy', () => {
  const originalTz = proc.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete proc.env.TZ;
    else proc.env.TZ = originalTz;
  });

  it('with TZ=America/New_York is the wall-clock time itself', () => {
    expect(proc.env.TZ).toBe('America/New_York');
    expect(localInputAtNy({ year: 2026, month: 10, day: 8 }, 9, 30)).toBe(
      '2026-10-08T09:30',
    );
    // EST side of the change
    expect(localInputAtNy({ year: 2026, month: 12, day: 8 }, 9, 30)).toBe(
      '2026-12-08T09:30',
    );
  });

  it('with a Melbourne device matches an explicit Melbourne formatter', () => {
    proc.env.TZ = 'Australia/Melbourne';
    // Guard: the runtime really switched zone.
    expect(new Date('2026-01-01T00:00:00Z').getHours()).toBe(11);

    const melbourne = (iso: string) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(iso));
      const p = (t: string) => parts.find((x) => x.type === t)!.value;
      return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
    };

    // 09:30 EDT on 8 Oct is 13:30Z, which is 00:30 on the 9th in Melbourne.
    expect(melbourne('2026-10-08T13:30:00Z')).toBe('2026-10-09T00:30');
    expect(localInputAtNy({ year: 2026, month: 10, day: 8 }, 9, 30)).toBe(
      '2026-10-09T00:30',
    );
    // 09:30 EST on 8 Dec is 14:30Z, which is 01:30 on the 9th in Melbourne.
    expect(localInputAtNy({ year: 2026, month: 12, day: 8 }, 9, 30)).toBe(
      melbourne('2026-12-08T14:30:00Z'),
    );
    // Days where only one city has changed clocks (US 8 Mar, AU 4 Oct/5 Apr).
    expect(localInputAtNy({ year: 2026, month: 3, day: 9 }, 9, 30)).toBe(
      melbourne('2026-03-09T13:30:00Z'),
    );
    expect(localInputAtNy({ year: 2026, month: 10, day: 5 }, 9, 30)).toBe(
      melbourne('2026-10-05T13:30:00Z'),
    );
  });

  it('with a Tokyo device matches the explicit instant', () => {
    proc.env.TZ = 'Asia/Tokyo';
    // 09:30 EDT = 13:30Z = 22:30 JST, same day.
    expect(localInputAtNy({ year: 2026, month: 10, day: 8 }, 9, 30)).toBe(
      '2026-10-08T22:30',
    );
  });
});
