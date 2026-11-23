import { formatDecimalFixed, parseDecimal } from '@trade-journal/shared';

const MINUS = '−';
const NARROW_NBSP = ' ';

/** Rounded to 2 dp from an exact decimal string; never touches a float. */
function fixed2(exact: string): {
  negative: boolean;
  zero: boolean;
  abs: string;
} {
  const text = formatDecimalFixed(parseDecimal(exact), 2);
  const negative = text.startsWith('-');
  const abs = negative ? text.slice(1) : text;
  return { negative, zero: !/[1-9]/.test(abs), abs };
}

export type Tone = 'gain' | 'loss' | 'neutral';

/** Thousands separators on the whole part of a money amount: `3,805.49`. */
function grouped(abs: string): string {
  const [whole = '', fraction] = abs.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? withCommas : `${withCommas}.${fraction}`;
}

/** `+$98.76`, `−$3,805.49`, `$0.00`. Zero after rounding has no sign. */
export function formatMoney(exact: string): { text: string; tone: Tone } {
  const fixed = fixed2(exact);
  const { negative, zero } = fixed;
  const abs = grouped(fixed.abs);
  if (zero) return { text: `$${abs}`, tone: 'neutral' };
  return negative
    ? { text: `${MINUS}$${abs}`, tone: 'loss' }
    : { text: `+$${abs}`, tone: 'gain' };
}

/** An unsigned amount such as the planned risk: `$1,250.00`. */
export function formatAmount(exact: string): string {
  return `$${grouped(fixed2(exact).abs)}`;
}

/** `+1.98 R` with a narrow no-break space before the R. */
export function formatR(exact: string): { text: string; tone: Tone } {
  const { negative, zero, abs } = fixed2(exact);
  if (zero) return { text: `${abs}${NARROW_NBSP}R`, tone: 'neutral' };
  return negative
    ? { text: `${MINUS}${abs}${NARROW_NBSP}R`, tone: 'loss' }
    : { text: `+${abs}${NARROW_NBSP}R`, tone: 'gain' };
}

/** Planned reward to risk as `1 : 4.00`, from an exact decimal string. */
export function formatRewardRisk(exact: string): string {
  return `1 : ${fixed2(exact).abs}`;
}

/** `datetime-local` value (device time zone) for a Date, to the minute. */
export function toLocalInputValue(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}`
  );
}

/**
 * A `datetime-local` value as UTC ISO 8601. A value the browser can't read is
 * returned untouched, so the schema rejects it instead of this throwing.
 */
export function localToUtc(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? local : date.toISOString();
}

/** `19 Nov`, with the year when it isn't the current one. */
export function formatShortDate(local: string, currentYear: number): string {
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** The trade list's local time of day, in the locale's 12- or 24-hour clock. */
export function formatTimeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** `Nov 19 · 09:41` in the device's time zone; the year when not current. */
export function formatOpened(iso: string, currentYear: number): string {
  const date = formatShortDate(iso, currentYear);
  const time = formatTimeOfDay(iso);
  return date && time ? `${date} · ${time}` : `${date}${time}`;
}
