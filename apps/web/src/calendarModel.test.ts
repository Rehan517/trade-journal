import type { TradeView } from '@trade-journal/shared';
import { describe, expect, it } from 'vitest';
import { buildMonth, formatCompactMoney } from './calendarModel.ts';

let seq = 0;
/** A closed trade (or an open one when `net` is undefined) opened at `at`. */
function trade(at: string, net?: string): TradeView {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    symbol: 'AAPL',
    instrumentType: 'stock',
    side: 'long',
    quantity: '1',
    entryPrice: '10',
    openedAt: at,
    fees: '0',
    createdAt: at,
    updatedAt: at,
    ...(net === undefined
      ? { metrics: {} }
      : { exitPrice: '11', closedAt: at, metrics: { netPnl: net } }),
  } as TradeView;
}
/** Midday UTC on an October 2026 day: the same New York date. */
const oct = (day: number, net?: string) =>
  trade(`2026-10-${String(day).padStart(2, '0')}T16:00:00.000Z`, net);

const TODAY_IN_OCT = { year: 2026, month: 10, day: 23 };
const TODAY_IN_NOV = { year: 2026, month: 11, day: 23 };
const build = (trades: TradeView[], today = TODAY_IN_NOV) =>
  buildMonth(trades, 2026, 10, today);
const dayOf = (view: ReturnType<typeof build>, day: number) =>
  view.weeks
    .flatMap((w) => w.days)
    .find((d) => d.inMonth && d.date.day === day)!;

describe('buildMonth grid', () => {
  it('Oct 2026 (starts Thursday), no trades: 5 weeks, Mon 28 Sep to Sun 4 Oct, stats all dashes', () => {
    const view = build([]);
    expect(view.title).toBe('October 2026');
    expect(view.weeks).toHaveLength(5);
    const first = view.weeks[0]!.days;
    expect(first).toHaveLength(7);
    expect(first[0]!.date).toEqual({ year: 2026, month: 9, day: 28 });
    expect(first[6]!.date).toEqual({ year: 2026, month: 10, day: 4 });
    expect(first.map((d) => d.inMonth)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    const last = view.weeks[4]!.days;
    expect(last[0]!.date).toEqual({ year: 2026, month: 10, day: 26 });
    expect(last[6]!.date).toEqual({ year: 2026, month: 11, day: 1 });
    expect(last[5]!.inMonth).toBe(true); // Sat 31 Oct
    expect(last[6]!.inMonth).toBe(false);
    expect(view.empty).toBe(true);
    for (const stat of Object.values(view.stats)) expect(stat.value).toBe('—');
  });

  it('Feb 2027 (starts Monday, 28 days): 4 weeks, no placeholders', () => {
    const view = buildMonth([], 2027, 2, TODAY_IN_NOV);
    expect(view.weeks).toHaveLength(4);
    expect(view.weeks.flatMap((w) => w.days).every((d) => d.inMonth)).toBe(
      true,
    );
    expect(view.weeks[0]!.days[0]!.date).toEqual({
      year: 2027,
      month: 2,
      day: 1,
    });
    expect(view.weeks[3]!.days[6]!.date).toEqual({
      year: 2027,
      month: 2,
      day: 28,
    });
  });

  it('Aug 2026 (starts Saturday, 31 days): 6 weeks', () => {
    const view = buildMonth([], 2026, 8, TODAY_IN_NOV);
    expect(view.weeks).toHaveLength(6);
    // Week 1 holds Sat 1 and Sun 2 only.
    expect(view.weeks[0]!.days.map((d) => d.inMonth)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(view.weeks[5]!.days[0]!.date).toEqual({
      year: 2026,
      month: 8,
      day: 31,
    });
    expect(view.weeks[5]!.days.filter((d) => d.inMonth)).toHaveLength(1);
  });

  it('numbers weeks from 1', () => {
    expect(build([]).weeks.map((w) => w.number)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('buildMonth days', () => {
  it('98.76 and -21.62 net 77.14: a gain with 2 trades', () => {
    const d = dayOf(build([oct(8, '98.76'), oct(8, '-21.62')]), 8);
    expect(d.net).toBe('77.14');
    expect(d.outcome).toBe('gain');
    expect(d.closed + d.open).toBe(2);
  });

  it('0.1 and 0.2 sum to exactly 0.3', () => {
    const view = build([oct(8, '0.1'), oct(8, '0.2')]);
    expect(dayOf(view, 8).net).toBe('0.3');
    expect(view.stats.netPnl.value).toBe('+$0.30');
  });

  it('a day whose net rounds to $0.00 is breakeven: unshaded, not counted green or red', () => {
    const view = build([oct(5, '0.004'), oct(6, '-0.004'), oct(7, '10')]);
    for (const n of [5, 6]) {
      const d = dayOf(view, n);
      expect(d.outcome).toBe('breakeven');
      expect(d.step).toBeNull();
    }
    expect(view.stats.winRate.context).toBe('1 green · 0 red days');
    expect(view.stats.bestDay.value).toBe('+$10.00');
    expect(view.stats.worstDay.value).toBe('—');
    // The sum stays exact.
    expect(dayOf(view, 5).net).toBe('0.004');
  });

  it('shades on the rounded net, so a sub-cent day cannot set the max', () => {
    const view = build([oct(5, '0.004'), oct(6, '5'), oct(7, '1')]);
    expect(dayOf(view, 6).step).toBe(3);
    expect(dayOf(view, 7).step).toBe(1);
  });

  it('exact sums carry into week and month totals', () => {
    const view = build([oct(5, '0.1'), oct(6, '0.2'), oct(12, '98.76')]);
    expect(view.weeks[1]!.net).toBe('0.3');
    expect(view.weeks[2]!.net).toBe('98.76');
    expect(view.stats.netPnl.value).toBe('+$99.06');
  });

  it('a day with one open trade: outcome none, 1 open, not shaded', () => {
    const d = dayOf(build([oct(8)]), 8);
    expect(d.outcome).toBe('none');
    expect(d.open).toBe(1);
    expect(d.closed).toBe(0);
    expect(d.net).toBeNull();
    expect(d.step).toBeNull();
  });

  it('an open trade adds to the count but never to a total', () => {
    const d = dayOf(build([oct(8, '50'), oct(8)]), 8);
    expect(d.net).toBe('50');
    expect(d.closed).toBe(1);
    expect(d.open).toBe(1);
  });

  it('-1 and 1 is breakeven, $0.00, not shaded', () => {
    const view = build([oct(8, '-1'), oct(8, '1')]);
    const d = dayOf(view, 8);
    expect(d.outcome).toBe('breakeven');
    expect(Number(d.net)).toBe(0);
    expect(d.step).toBeNull();
    expect(view.stats.netPnl.value).toBe('$0.00');
  });

  it('a day with no trades is outcome none', () => {
    const d = dayOf(build([oct(8, '5')]), 9);
    expect(d.outcome).toBe('none');
    expect(d.net).toBeNull();
    expect(d.closed + d.open).toBe(0);
  });

  it('a loss day is outcome loss', () => {
    expect(dayOf(build([oct(8, '-0.01')]), 8).outcome).toBe('loss');
  });
});

describe('buildMonth shading', () => {
  it('+600, +200, -250, +150 give steps 3, 1, 2, 1', () => {
    const view = build([
      oct(5, '600'),
      oct(6, '200'),
      oct(7, '-250'),
      oct(8, '150'),
    ]);
    expect([5, 6, 7, 8].map((d) => dayOf(view, d).step)).toEqual([3, 1, 2, 1]);
    expect(dayOf(view, 7).outcome).toBe('loss');
  });

  it('the boundary |net| x 3 = max x 2 is step 2, just above is step 3', () => {
    const view = build([oct(5, '300'), oct(6, '200'), oct(7, '200.01')]);
    expect(dayOf(view, 5).step).toBe(3);
    expect(dayOf(view, 6).step).toBe(2);
    expect(dayOf(view, 7).step).toBe(3);
  });

  it('a month with one trading day shades it step 3', () => {
    expect(dayOf(build([oct(8, '12.34')]), 8).step).toBe(3);
    expect(dayOf(build([oct(8, '-0.01')]), 8).step).toBe(3);
  });

  it('the biggest loss sets max too', () => {
    const view = build([oct(5, '-600'), oct(6, '100')]);
    expect(dayOf(view, 5).step).toBe(3);
    expect(dayOf(view, 6).step).toBe(1);
  });

  it('open days and placeholder days are never shaded', () => {
    const view = build([oct(5, '100'), oct(6)]);
    expect(dayOf(view, 6).step).toBeNull();
    const placeholders = view.weeks
      .flatMap((w) => w.days)
      .filter((d) => !d.inMonth);
    expect(placeholders.every((d) => d.step === null)).toBe(true);
  });
});

describe('buildMonth time zones', () => {
  it('2026-11-01T03:59:59Z (31 Oct 23:59 EDT) belongs to October, not November', () => {
    const t = trade('2026-11-01T03:59:59.000Z', '40');
    const octView = buildMonth([t], 2026, 10, TODAY_IN_NOV);
    expect(dayOf(octView, 31).net).toBe('40');
    expect(octView.stats.trades.value).toBe('1');
    const novView = buildMonth([t], 2026, 11, TODAY_IN_NOV);
    expect(novView.empty).toBe(true);
    expect(novView.stats.trades.value).toBe('—');
  });

  it('2026-11-01T04:00:00Z is the first moment of November', () => {
    const t = trade('2026-11-01T04:00:00.000Z', '40');
    expect(build([t]).empty).toBe(true);
    const nov = buildMonth([t], 2026, 11, TODAY_IN_NOV);
    expect(
      nov.weeks[0]!.days.find((d) => d.date.day === 1 && d.inMonth)!.net,
    ).toBe('40');
  });

  it('a late Friday US evening (Saturday in UTC) stays on Friday', () => {
    // Fri 9 Oct 23:30 EDT = 10 Oct 03:30Z
    const view = build([trade('2026-10-10T03:30:00.000Z', '10')]);
    expect(dayOf(view, 9).net).toBe('10');
    expect(dayOf(view, 10).net).toBeNull();
  });
});

describe('buildMonth weeks', () => {
  it('week 1 of October 2026 counts 1-4 Oct only', () => {
    const view = build([
      trade('2026-09-30T16:00:00.000Z', '1000'), // outside the month
      oct(1, '10'),
      oct(4, '5'),
      oct(5, '100'),
    ]);
    expect(view.weeks[0]!.net).toBe('15');
    expect(view.weeks[0]!.trades).toBe(2);
    expect(view.weeks[1]!.net).toBe('100');
    expect(view.stats.trades.value).toBe('3');
    expect(view.stats.netPnl.value).toBe('+$115.00');
  });

  it('the last week counts only in-month days (Nov 1 is outside)', () => {
    const view = build([
      oct(31, '7'),
      trade('2026-11-01T16:00:00.000Z', '900'),
    ]);
    expect(view.weeks[4]!.net).toBe('7');
    expect(view.weeks[4]!.trades).toBe(1);
  });

  it('week trades include open trades; a week of only open trades has no net', () => {
    const view = build([oct(12), oct(13, '5'), oct(13)]);
    expect(view.weeks[2]!.trades).toBe(3);
    expect(view.weeks[2]!.net).toBe('5');
    const onlyOpen = build([oct(12)]);
    expect(onlyOpen.weeks[2]!.net).toBeNull();
    expect(onlyOpen.weeks[2]!.trades).toBe(1);
  });

  it('a week with no trades has no net and 0 trades', () => {
    const view = build([oct(5, '1')]);
    expect(view.weeks[3]!.net).toBeNull();
    expect(view.weeks[3]!.trades).toBe(0);
  });
});

describe('buildMonth stats', () => {
  const sample = [
    oct(5, '600'), // green, best
    oct(6, '200'), // green
    oct(7, '-250'), // red, worst
    oct(8, '-50'), // red
    oct(8), // open on a closed day
    oct(9), // open only day
  ];

  it('computes the five stats from a month', () => {
    const { stats } = build(sample);
    expect(stats.netPnl.value).toBe('+$500.00');
    expect(stats.netPnl.tone).toBe('gain');
    expect(stats.winRate.value).toBe('50%');
    expect(stats.winRate.context).toBe('2 green · 2 red days');
    expect(stats.trades.value).toBe('6');
    expect(stats.bestDay.value).toBe('+$600.00');
    expect(stats.bestDay.context).toBe('Oct 5');
    expect(stats.worstDay.value).toBe('−$250.00');
    expect(stats.worstDay.context).toBe('Oct 7');
    expect(stats.worstDay.tone).toBe('loss');
  });

  it('trades context counts trading days and appends the open count', () => {
    expect(build(sample).stats.trades.context).toBe('5 trading days · 2 open');
    expect(build([oct(5, '1'), oct(6, '2')]).stats.trades.context).toBe(
      '2 trading days',
    );
  });

  it('uses the singular for one trading day', () => {
    expect(build([oct(5, '1')]).stats.trades.context).toBe('1 trading day');
  });

  it('net P&L context is "October to date" for the current month', () => {
    expect(build(sample, TODAY_IN_OCT).stats.netPnl.context).toBe(
      'October to date',
    );
  });

  it('net P&L context is "October 2026" for a past month', () => {
    expect(build(sample, TODAY_IN_NOV).stats.netPnl.context).toBe(
      'October 2026',
    );
  });

  it('the same month number in another year is not the current month', () => {
    expect(
      build(sample, { year: 2027, month: 10, day: 5 }).stats.netPnl.context,
    ).toBe('October 2026');
  });

  it('win rate rounds to a whole percent', () => {
    const view = build([oct(5, '1'), oct(6, '1'), oct(7, '-1')]);
    expect(view.stats.winRate.value).toBe('67%');
    expect(view.stats.winRate.context).toBe('2 green · 1 red days');
  });

  it('breakeven days count in the win rate denominator only', () => {
    const view = build([oct(5, '5'), oct(6, '1'), oct(6, '-1')]);
    expect(view.stats.winRate.value).toBe('50%');
    expect(view.stats.winRate.context).toBe('1 green · 0 red days');
  });

  it('open trades do not count in the win rate', () => {
    expect(build([oct(5, '5'), oct(6)]).stats.winRate.value).toBe('100%');
  });

  it('no gain day: Best day is a dash with "No winning days"', () => {
    const { stats } = build([oct(5, '-5'), oct(6, '-9')]);
    expect(stats.bestDay.value).toBe('—');
    expect(stats.bestDay.context).toBe('No winning days');
    expect(stats.worstDay.value).toBe('−$9.00');
    expect(stats.worstDay.context).toBe('Oct 6');
    expect(stats.winRate.value).toBe('0%');
  });

  it('no loss day: Worst day is a dash with "No losing days"', () => {
    const { stats } = build([oct(5, '5'), oct(6, '9')]);
    expect(stats.worstDay.value).toBe('—');
    expect(stats.worstDay.context).toBe('No losing days');
    expect(stats.bestDay.value).toBe('+$9.00');
  });

  it('a breakeven-only month has neither best nor worst day', () => {
    const { stats } = build([oct(5, '1'), oct(5, '-1')]);
    expect(stats.bestDay.context).toBe('No winning days');
    expect(stats.worstDay.context).toBe('No losing days');
  });

  it('empty month: all dashes and the empty-state context lines', () => {
    const view = build([]);
    expect(view.empty).toBe(true);
    expect(view.stats.netPnl.context).toBe(
      'No trades in October. Log a trade.',
    );
    expect(view.stats.winRate.context).toBe('No closed trades');
    expect(view.stats.trades.context).toBe('No trading days');
    expect(view.stats.bestDay.context).toBe('No winning days');
    expect(view.stats.worstDay.context).toBe('No losing days');
  });

  it('open-only month: Trades count shown, other values dashes, not "empty"', () => {
    const view = build([oct(5), oct(6)]);
    expect(view.empty).toBe(false);
    expect(view.stats.trades.value).toBe('2');
    expect(view.stats.trades.context).toBe('2 trading days · 2 open');
    expect(view.stats.netPnl.value).toBe('—');
    expect(view.stats.netPnl.context).toBe('No closed trades yet');
    expect(view.stats.winRate.value).toBe('—');
    expect(view.stats.bestDay.value).toBe('—');
    expect(view.stats.worstDay.value).toBe('—');
  });

  it('formats negative month net with the minus sign', () => {
    expect(build([oct(5, '-12.5')]).stats.netPnl.value).toBe('−$12.50');
  });

  it('ignores trades outside the month entirely', () => {
    const view = build([trade('2026-09-15T16:00:00.000Z', '99')]);
    expect(view.empty).toBe(true);
    expect(view.stats.trades.value).toBe('—');
  });
});

describe('formatCompactMoney', () => {
  it.each([
    ['334', '+334'],
    ['-56', '−56'],
    ['334.4', '+334'],
    ['334.5', '+335'],
    ['-334.5', '−335'],
    ['999.49', '+999'],
    ['1300', '+1.3k'],
    ['-1300', '−1.3k'],
    ['1250', '+1.3k'],
    ['-1250', '−1.3k'],
    ['1249.99', '+1.2k'],
    ['2000', '+2k'],
    ['-2000', '−2k'],
    ['9949', '+9.9k'],
    ['13000', '+13k'],
    ['-13000', '−13k'],
    ['12500', '+13k'],
    ['12499.99', '+12k'],
    ['123456.78', '+123k'],
    ['0', '0'],
    ['0.00', '0'],
    ['-0', '0'],
  ])('%s reads %s', (exact, expected) => {
    expect(formatCompactMoney(exact)).toBe(expected);
  });

  it('reads plain 0 for a nonzero amount that rounds to zero, never +0 or −0', () => {
    expect(formatCompactMoney('0.4')).toBe('0');
    expect(formatCompactMoney('-0.4')).toBe('0');
    expect(formatCompactMoney('0.01')).toBe('0');
    expect(formatCompactMoney('-0.004')).toBe('0');
  });

  it('rounds half away from zero at the dollar', () => {
    expect(formatCompactMoney('0.5')).toBe('+1');
    expect(formatCompactMoney('-0.5')).toBe('−1');
    expect(formatCompactMoney('2.5')).toBe('+3');
    expect(formatCompactMoney('-2.5')).toBe('−3');
  });

  it('crossing 10,000 on rounding shows whole thousands', () => {
    expect(formatCompactMoney('9950')).toBe('+10k');
    expect(formatCompactMoney('10000')).toBe('+10k');
  });

  it('a value that rounds up to 1,000 reads as thousands', () => {
    expect(formatCompactMoney('999.5')).toBe('+1k');
  });
});
