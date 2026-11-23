import {
  absDecimal,
  addDecimal,
  compareDecimal,
  decimalToString,
  divideDecimal,
  formatDecimalFixed,
  multiplyDecimal,
  parseDecimal,
  signDecimal,
  type Decimal,
  type TradeView,
} from '@trade-journal/shared';
import { formatMoney, type Tone } from './format.ts';
import { nyDateOf, type NyDate } from './tradingDay.ts';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MINUS = '−';
const ZERO: Decimal = { coefficient: 0n, scale: 0 };

export type Outcome = 'gain' | 'loss' | 'breakeven' | 'none';
export type ShadeStep = 1 | 2 | 3;

export interface DayView {
  date: NyDate;
  /** `2026-10-08`: unique, and the React key. */
  key: string;
  /** False for the placeholder days that pad the first and last week. */
  inMonth: boolean;
  closed: number;
  open: number;
  /** Exact sum of the closed trades' net P&L; null with no closed trades. */
  net: string | null;
  outcome: Outcome;
  /** Shade strength for a gain or loss day; null otherwise. */
  step: ShadeStep | null;
}

export interface WeekView {
  /** 1-based, counted from the first row. */
  number: number;
  days: DayView[];
  /** Exact net of the week's in-month days; null with no closed trades. */
  net: string | null;
  /** Every trade on the week's in-month days, open ones included. */
  trades: number;
}

export interface Stat {
  /** Display text; "—" when there is nothing to show. */
  value: string;
  tone: Tone;
  context: string;
}

export interface MonthView {
  year: number;
  month: number;
  /** `October 2026` */
  title: string;
  /** `October` */
  monthName: string;
  weeks: WeekView[];
  /** True when the month has no trades at all, open or closed. */
  empty: boolean;
  stats: {
    netPnl: Stat;
    winRate: Stat;
    trades: Stat;
    bestDay: Stat;
    worstDay: Stat;
  };
}

export function dateKey({ year, month, day }: NyDate): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}`;
}

/** `Oct 8` */
export function shortDate({ month, day }: NyDate): string {
  return `${MONTHS[month - 1]!.slice(0, 3)} ${day}`;
}

const DAY_MS = 86_400_000;

/** Calendar arithmetic on a date, through UTC so no time zone is involved. */
function addDays(date: NyDate, n: number): NyDate {
  const d = new Date(
    Date.UTC(date.year, date.month - 1, date.day) + n * DAY_MS,
  );
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** 0 for Monday to 6 for Sunday. */
function weekdayIndex({ year, month, day }: NyDate): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function compareDates(a: NyDate, b: NyDate): number {
  return (
    a.year - b.year || a.month - b.month || a.day - b.day // 0 when the same
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A net rounded to cents, the value the trader sees. Exact decimals only. */
function cents(d: Decimal): Decimal {
  return parseDecimal(formatDecimalFixed(d, 2));
}

function shadeStep(net: Decimal, max: Decimal): ShadeStep {
  const triple = multiplyDecimal(absDecimal(net), {
    coefficient: 3n,
    scale: 0,
  });
  if (compareDecimal(triple, max) <= 0) return 1;
  if (
    compareDecimal(
      triple,
      multiplyDecimal(max, { coefficient: 2n, scale: 0 }),
    ) <= 0
  )
    return 2;
  return 3;
}

/** Everything the calendar page draws for one New York month. */
export function buildMonth(
  trades: TradeView[],
  year: number,
  month: number,
  today: NyDate,
): MonthView {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first: NyDate = { year, month, day: 1 };
  const last: NyDate = { year, month, day: daysInMonth };

  // Group by the New York date of `openedAt`. A trade outside the month
  // (the API range should prevent one) counts nowhere.
  const byDay = new Map<
    string,
    { closed: number; open: number; net: Decimal | null }
  >();
  for (const trade of trades) {
    const date = nyDateOf(trade.openedAt);
    if (date.year !== year || date.month !== month) continue;
    const key = dateKey(date);
    const entry = byDay.get(key) ?? { closed: 0, open: 0, net: null };
    const netPnl = trade.metrics.netPnl;
    if (netPnl === undefined) {
      entry.open += 1;
    } else {
      entry.closed += 1;
      entry.net = addDecimal(entry.net ?? ZERO, parseDecimal(netPnl));
    }
    byDay.set(key, entry);
  }

  // The month's largest absolute day, for shading.
  let max: Decimal = ZERO;
  for (const { net } of byDay.values()) {
    if (net && compareDecimal(absDecimal(cents(net)), max) > 0)
      max = absDecimal(cents(net));
  }

  const start = addDays(first, -weekdayIndex(first));
  const rows = Math.ceil((weekdayIndex(first) + daysInMonth) / 7);
  const weeks: WeekView[] = [];
  for (let w = 0; w < rows; w += 1) {
    const days: DayView[] = [];
    let weekNet: Decimal | null = null;
    let weekTrades = 0;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, w * 7 + i);
      const inMonth =
        compareDates(date, first) >= 0 && compareDates(date, last) <= 0;
      const entry = inMonth ? byDay.get(dateKey(date)) : undefined;
      const net = entry?.net ?? null;
      // Outcome and shade follow the rounded net, so a day showing $0.00
      // is breakeven, never a faint gain or loss.
      const shown = net === null ? null : cents(net);
      const outcome: Outcome =
        shown === null
          ? 'none'
          : signDecimal(shown) > 0
            ? 'gain'
            : signDecimal(shown) < 0
              ? 'loss'
              : 'breakeven';
      days.push({
        date,
        key: dateKey(date),
        inMonth,
        closed: entry?.closed ?? 0,
        open: entry?.open ?? 0,
        net: net === null ? null : decimalToString(net),
        outcome,
        step:
          outcome === 'gain' || outcome === 'loss'
            ? shadeStep(shown!, max)
            : null,
      });
      if (entry) {
        weekTrades += entry.closed + entry.open;
        if (net) weekNet = addDecimal(weekNet ?? ZERO, net);
      }
    }
    weeks.push({
      number: w + 1,
      days,
      net: weekNet === null ? null : decimalToString(weekNet),
      trades: weekTrades,
    });
  }

  return {
    year,
    month,
    title: `${MONTHS[month - 1]} ${year}`,
    monthName: MONTHS[month - 1]!,
    weeks,
    empty: byDay.size === 0,
    stats: buildStats(weeks, year, month, today),
  };
}

const DASH = '—';

function moneyStat(exact: string, context: string): Stat {
  const { text, tone } = formatMoney(exact);
  return { value: text, tone, context };
}

function buildStats(
  weeks: WeekView[],
  year: number,
  month: number,
  today: NyDate,
): MonthView['stats'] {
  const monthName = MONTHS[month - 1]!;
  const days = weeks.flatMap((w) => w.days).filter((d) => d.inMonth);

  let total: Decimal | null = null;
  let greenDays = 0;
  let redDays = 0;
  let closedDays = 0;
  let trades = 0;
  let openTrades = 0;
  let tradedDays = 0;
  let best: DayView | null = null;
  let worst: DayView | null = null;
  for (const day of days) {
    trades += day.closed + day.open;
    openTrades += day.open;
    if (day.closed + day.open > 0) tradedDays += 1;
    if (day.net === null) continue;
    closedDays += 1;
    total = addDecimal(total ?? ZERO, parseDecimal(day.net));
    if (day.outcome === 'gain') {
      greenDays += 1;
      if (
        !best ||
        compareDecimal(
          cents(parseDecimal(day.net)),
          cents(parseDecimal(best.net!)),
        ) > 0
      )
        best = day;
    } else if (day.outcome === 'loss') {
      redDays += 1;
      if (
        !worst ||
        compareDecimal(
          cents(parseDecimal(day.net)),
          cents(parseDecimal(worst.net!)),
        ) < 0
      )
        worst = day;
    }
  }

  const noValue = (context: string): Stat => ({
    value: DASH,
    tone: 'neutral',
    context,
  });
  const isCurrent = today.year === year && today.month === month;

  const netPnl =
    total === null
      ? noValue(
          trades === 0
            ? `No trades in ${monthName}. Log a trade.`
            : 'No closed trades yet',
        )
      : moneyStat(
          decimalToString(total),
          isCurrent ? `${monthName} to date` : `${monthName} ${year}`,
        );

  const winRate =
    closedDays === 0
      ? noValue('No closed trades')
      : {
          value: `${Math.round((greenDays / closedDays) * 100)}%`,
          tone: 'neutral' as Tone,
          context: `${greenDays} green · ${redDays} red days`,
        };

  const tradesStat: Stat = {
    value: trades === 0 ? DASH : String(trades),
    tone: 'neutral',
    context:
      trades === 0
        ? 'No trading days'
        : plural(tradedDays, 'trading day', 'trading days') +
          (openTrades > 0 ? ` · ${openTrades} open` : ''),
  };

  return {
    netPnl,
    winRate,
    trades: tradesStat,
    bestDay: best
      ? moneyStat(best.net!, shortDate(best.date))
      : noValue('No winning days'),
    worstDay: worst
      ? moneyStat(worst.net!, shortDate(worst.date))
      : noValue('No losing days'),
  };
}

/**
 * A day amount short enough for a phone cell: sign and whole dollars below
 * 1,000 (`+334`, `−56`), thousands to one decimal below 10,000 (`+1.3k`),
 * else whole thousands (`+13k`). Rounds half away from zero on exact decimals.
 */
export function formatCompactMoney(exact: string): string {
  const value = parseDecimal(exact);
  const sign = signDecimal(value);
  // Zero cents, or nothing left after whole dollars, reads plain 0.
  if (signDecimal(cents(value)) === 0) return '0';
  const prefix = sign < 0 ? MINUS : '+';
  const abs = absDecimal(value);
  const thousand: Decimal = { coefficient: 1000n, scale: 0 };
  const whole = divideDecimal(abs, { coefficient: 1n, scale: 0 }, 0);
  if (signDecimal(whole) === 0) return '0';
  if (compareDecimal(whole, thousand) < 0) {
    return `${prefix}${formatDecimalFixed(whole, 0)}`;
  }
  const tenths = divideDecimal(abs, thousand, 1);
  if (compareDecimal(tenths, { coefficient: 10n, scale: 0 }) < 0) {
    return `${prefix}${decimalToString(tenths)}k`;
  }
  return `${prefix}${formatDecimalFixed(divideDecimal(abs, thousand, 0), 0)}k`;
}
