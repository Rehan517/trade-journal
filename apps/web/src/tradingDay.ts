import { toLocalInputValue } from './format.ts';

/** A calendar date on the New York trading calendar. `month` is 1 to 12. */
export type NyDate = { year: number; month: number; day: number };

const NY = 'America/New_York';

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: NY,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetParts = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  timeZoneName: 'longOffset',
});

/** The New York date of an instant (a UTC ISO string or a Date). */
export function nyDateOf(instant: string | Date): NyDate {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = dateParts.formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** New York's UTC offset in minutes at an instant (-240 in EDT, -300 in EST). */
function nyOffsetMinutes(at: number): number {
  const name = offsetParts
    .formatToParts(new Date(at))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name ?? '');
  if (!m) throw new Error(`Unexpected time zone offset: ${String(name)}`);
  if (!m[1]) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * The instant of New York midnight at the start of a date, as UTC ISO 8601.
 * The offset is read at 05:00 UTC that day: New York's changes happen at
 * 02:00 local (06:00 or 07:00 UTC), so 05:00 UTC always sits before one.
 */
export function nyMidnightUtc(date: NyDate): string {
  const midnightAsUtc = Date.UTC(date.year, date.month - 1, date.day);
  const offset = nyOffsetMinutes(midnightAsUtc + 5 * 3_600_000);
  return new Date(midnightAsUtc - offset * 60_000).toISOString();
}

/** UTC bounds of a New York month: `from` inclusive, `to` exclusive. */
export function monthRange(
  year: number,
  month: number,
): { from: string; to: string } {
  const next =
    month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    from: nyMidnightUtc({ year, month, day: 1 }),
    to: nyMidnightUtc({ ...next, day: 1 }),
  };
}

/** The New York date at `now`. */
export function nyToday(now: Date): NyDate {
  return nyDateOf(now);
}

/**
 * A `datetime-local` value (device time zone) for a New York wall-clock time
 * on a date, so the form's local to UTC step sends the right instant.
 */
export function localInputAtNy(
  date: NyDate,
  hour: number,
  minute: number,
): string {
  const wallAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  // Settle the offset at the instant itself, in case a change falls between.
  const first = wallAsUtc - nyOffsetMinutes(wallAsUtc) * 60_000;
  const instant = wallAsUtc - nyOffsetMinutes(first) * 60_000;
  return toLocalInputValue(new Date(instant));
}
