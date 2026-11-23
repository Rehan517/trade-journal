import { useEffect, useMemo, useRef, useState } from 'react';
import type { TradeView } from '@trade-journal/shared';
import { ApiError, INVALID_RESPONSE_STATUS, listTrades } from './api.ts';
import {
  buildMonth,
  compareDates,
  formatCompactMoney,
  shortDate,
  type DayView,
  type Stat,
  type WeekView,
} from './calendarModel.ts';
import { formatMoney } from './format.ts';
import {
  localInputAtNy,
  monthRange,
  nyDateOf,
  nyMidnightUtc,
  nyToday,
} from './tradingDay.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const WEEKDAYS = [
  ['Monday', 'Mon', 'M'],
  ['Tuesday', 'Tue', 'T'],
  ['Wednesday', 'Wed', 'W'],
  ['Thursday', 'Thu', 'T'],
  ['Friday', 'Fri', 'F'],
  ['Saturday', 'Sat', 'S'],
  ['Sunday', 'Sun', 'S'],
] as const;

type LoadFailure = 'session' | 'network';

/** Every page of one month's trades, or throws. */
async function loadMonth(
  apiUrl: string,
  token: string,
  year: number,
  month: number,
  fetchFn: typeof fetch | undefined,
  signal: AbortSignal,
): Promise<TradeView[]> {
  const { from, to } = monthRange(year, month);
  const trades: TradeView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listTrades(
      apiUrl,
      token,
      { from, to, limit: PAGE_SIZE, cursor },
      fetchFn,
      signal,
    );
    trades.push(...result.items);
    if (!result.nextCursor) return trades;
    cursor = result.nextCursor;
  }
  throw new ApiError(INVALID_RESPONSE_STATUS, 'Month has too many trades');
}

/** Milliseconds until the next New York midnight after `at`. */
function msToNyMidnight(at: Date): number {
  const { year, month, day } = nyDateOf(at);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const date = {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
  return Math.max(1, Date.parse(nyMidnightUtc(date)) - at.getTime());
}

const monthKey = (year: number, month: number) => `${year}-${month}`;

export function CalendarPage({
  apiUrl,
  accessToken,
  onSignIn,
  fetchFn,
  now = () => new Date(),
  onLogTrade,
  refreshKey = 0,
}: {
  apiUrl: string;
  accessToken: string | undefined;
  /** Starts sign-in again, for the "session expired" alert. */
  onSignIn: () => void;
  /** Used for the API calls; replaceable in tests. */
  fetchFn?: typeof fetch;
  /** The clock; replaceable in tests. */
  now?: () => Date;
  /**
   * The trader wants to log a trade. `initialOpenedAt` is a `datetime-local`
   * value, or undefined for now. `opener` gets focus back when the dialog
   * closes.
   */
  onLogTrade: (
    initialOpenedAt: string | undefined,
    opener: HTMLElement,
  ) => void;
  /** Bumped by the parent after a save; the shown month is fetched again. */
  refreshKey?: number;
}) {
  // The clock is state so "today" moves at New York midnight while the page
  // stays open. The shown month is left where it is.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  });
  const [clock, setClock] = useState(() => now());
  const today = useMemo(() => nyToday(clock), [clock]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const current = nowRef.current();
      setClock((prev) => {
        const a = nyToday(prev);
        const b = nyToday(current);
        return a.year === b.year && a.month === b.month && a.day === b.day
          ? prev
          : current;
      });
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sync();
        arm();
      }, msToNyMidnight(nowRef.current()));
    };
    // Timers pause while a device sleeps, so look at the clock again when
    // the tab comes back.
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      sync();
      arm();
    };
    arm();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);
  const [shown, setShown] = useState({ year: today.year, month: today.month });
  const key = monthKey(shown.year, shown.month);
  const [retries, setRetries] = useState(0);
  const attempt = `${refreshKey}:${retries}`;

  // The last month that loaded in full, and the last failure. Both carry the
  // month they belong to, so another month's figures never show under this
  // month's title. A same-month refetch leaves `loaded` alone until its
  // replacement arrives.
  const [loaded, setLoaded] = useState<{
    key: string;
    trades: TradeView[];
  } | null>(null);
  const [failed, setFailed] = useState<{
    key: string;
    attempt: string;
    kind: LoadFailure;
  } | null>(null);

  const { year, month } = shown;
  useEffect(() => {
    if (!accessToken) {
      // Defer: state changes inside the effect body would cascade a render.
      const id = setTimeout(() => {
        setLoaded(null);
        setFailed({ key, attempt, kind: 'session' });
      }, 0);
      return () => clearTimeout(id);
    }
    // Navigating aborts this request, so a slow month can't land late.
    const controller = new AbortController();
    loadMonth(
      apiUrl,
      accessToken,
      year,
      month,
      fetchFn,
      controller.signal,
    ).then(
      (trades) => {
        if (controller.signal.aborted) return;
        setFailed(null);
        setLoaded({ key, trades });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded(null);
        setFailed({
          key,
          attempt,
          kind:
            err instanceof ApiError && err.status === 401
              ? 'session'
              : 'network',
        });
      },
    );
    return () => {
      controller.abort();
      // A failure belongs to the request that raised it; leaving or
      // refetching the month must not bring it back later.
      setFailed(null);
    };
  }, [apiUrl, accessToken, fetchFn, year, month, key, attempt]);

  const failure =
    failed && failed.key === key && failed.attempt === attempt
      ? failed.kind
      : null;
  const data = !failure && loaded?.key === key ? loaded.trades : null;
  const loading = data === null && failure === null;

  const view = useMemo(
    () => buildMonth(data ?? [], year, month, today),
    [data, year, month, today],
  );
  const hasData = data !== null;

  // The opener can disappear in a refetch (the empty-month button). Focus
  // would then fall to the page, so it goes to the month title instead.
  const openerRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = openerRef.current;
    if (!opener || opener.isConnected) return;
    openerRef.current = null;
    if (
      document.activeElement === document.body ||
      document.activeElement === null
    ) {
      titleRef.current?.focus();
    }
  }, [data]);
  const logTrade = (initial: string | undefined, opener: HTMLElement) => {
    openerRef.current = opener;
    onLogTrade(initial, opener);
  };

  const go = (delta: number) => {
    const index = shown.year * 12 + (shown.month - 1) + delta;
    setShown({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };

  const stats: [string, Stat][] = [
    ['Net P&L', view.stats.netPnl],
    ['Day win rate', view.stats.winRate],
    ['Trades', view.stats.trades],
    ['Best day', view.stats.bestDay],
    ['Worst day', view.stats.worstDay],
  ];
  const showEmptyCopy = hasData && view.empty;

  return (
    <div className="calendar">
      <div className="calendar__head">
        <h1 className="calendar__title" ref={titleRef} tabIndex={-1}>
          {view.title}
        </h1>
        <div className="calendar__nav">
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Previous month"
            onClick={() => go(-1)}
          >
            <Chevron direction="left" />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Next month"
            onClick={() => go(1)}
          >
            <Chevron direction="right" />
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShown({ year: today.year, month: today.month })}
          >
            Today
          </button>
        </div>
        <Legend />
      </div>

      {failure && (
        <div className="alert calendar__alert" role="alert">
          {failure === 'session' ? (
            <>
              <p>Your session has expired. Sign in again.</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onSignIn}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <p>
                Couldn&rsquo;t load your trades. Check your connection and try
                again.
              </p>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setRetries((n) => n + 1)}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      <div className="stats" role="group" aria-label="Month summary">
        {stats.map(([name, stat], index) => (
          <div className="stat" key={name}>
            <p className="stat__name">{name}</p>
            <p
              className="stat__value"
              data-tone={hasData ? stat.tone : 'neutral'}
            >
              {hasData ? stat.value : '—'}
            </p>
            <p className="stat__context">
              {hasData ? (
                index === 0 && showEmptyCopy ? (
                  <>
                    No trades in {view.monthName}.{' '}
                    <button
                      type="button"
                      className="btn btn--quiet stat__action"
                      onClick={(e) => logTrade(undefined, e.currentTarget)}
                    >
                      Log a trade
                    </button>
                  </>
                ) : (
                  stat.context
                )
              ) : (
                ' '
              )}
            </p>
          </div>
        ))}
      </div>

      <p className="sr-only" role="status">
        {loading ? 'Loading…' : ''}
      </p>

      <section
        className="cal"
        aria-label="Daily profit and loss"
        aria-busy={loading}
      >
        <div className="cal__body">
          <div className="cal__grid">
            {WEEKDAYS.map(([full, long, short]) => (
              <div className="cal__weekday" key={full}>
                <abbr title={full}>
                  <span className="cal__wd-long">{long}</span>
                  <span className="cal__wd-short">{short}</span>
                </abbr>
              </div>
            ))}
            <div className="cal__weekday cal__weekday--week">Week</div>
            {view.weeks.map((week) => (
              <WeekRow
                key={week.number}
                week={week}
                today={today}
                hasData={hasData}
                onLogTrade={logTrade}
              />
            ))}
          </div>
          <ol className="cal__weeklist" aria-label="Weekly totals">
            {view.weeks.map((week) => (
              <li key={week.number}>{weekSummary(week, hasData)}</li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}

function weekSummary(week: WeekView, hasData: boolean): string {
  if (!hasData) return `Week ${week.number}`;
  const total = week.net === null ? '—' : formatMoney(week.net).text;
  return `Week ${week.number} · ${total} · ${week.trades === 1 ? '1 trade' : `${week.trades} trades`}`;
}

function WeekRow({
  week,
  today,
  hasData,
  onLogTrade,
}: {
  week: WeekView;
  today: ReturnType<typeof nyToday>;
  hasData: boolean;
  onLogTrade: (
    initialOpenedAt: string | undefined,
    opener: HTMLElement,
  ) => void;
}) {
  const total = hasData && week.net !== null ? formatMoney(week.net) : null;
  return (
    <>
      {week.days.map((day) => (
        <DayCell
          key={day.key}
          day={day}
          today={today}
          hasData={hasData}
          onLogTrade={onLogTrade}
        />
      ))}
      <div className="cal__week">
        <p className="cal__week-name">Week {week.number}</p>
        <p className="cal__week-total" data-tone={total?.tone ?? 'muted'}>
          {total ? total.text : '—'}
        </p>
        <p className="cal__week-count">
          {hasData
            ? week.trades === 1
              ? '1 trade'
              : `${week.trades} trades`
            : ' '}
        </p>
      </div>
    </>
  );
}

function dayLabel(day: DayView, isFuture: boolean, hasData: boolean): string {
  const date = shortDate(day.date);
  if (!day.inMonth) return `${date}: outside this month`;
  const count = day.closed + day.open;
  if (isFuture && (!hasData || count === 0)) return `${date}: not yet`;
  if (!hasData) return `${date}: Log a trade`;
  if (count === 0) return `${date}: no trades. Log a trade`;
  const trades = count === 1 ? '1 trade' : `${count} trades`;
  const open = day.open > 0 && day.closed > 0 ? `, ${day.open} open` : '';
  if (day.net === null) return `${date}: ${day.open} open`;
  return `${date}: ${formatMoney(day.net).text}, ${trades}${open}`;
}

function DayCell({
  day,
  today,
  hasData,
  onLogTrade,
}: {
  day: DayView;
  today: ReturnType<typeof nyToday>;
  hasData: boolean;
  onLogTrade: (
    initialOpenedAt: string | undefined,
    opener: HTMLElement,
  ) => void;
}) {
  const order = compareDates(day.date, today);
  const isToday = day.inMonth && order === 0;
  const isFuture = order > 0;
  const count = day.closed + day.open;
  // A future day that already has trades can still log another.
  const disabled = !day.inMonth || (isFuture && !(hasData && count > 0));

  // Shade classes only once the data is in, so a loading grid is plain.
  const state = !day.inMonth
    ? 'off'
    : isFuture && !(hasData && count > 0)
      ? 'future'
      : hasData && day.step !== null
        ? `${day.outcome}-${day.step}`
        : 'plain';

  return (
    <button
      type="button"
      className="cal__day"
      data-state={state}
      data-today={isToday ? 'true' : undefined}
      disabled={disabled}
      aria-label={dayLabel(day, isFuture, hasData)}
      aria-current={isToday ? 'date' : undefined}
      onClick={(e) =>
        onLogTrade(
          isToday ? undefined : localInputAtNy(day.date, 9, 30),
          e.currentTarget,
        )
      }
    >
      <span className="cal__num">
        {day.date.day}
        {isToday && <span className="cal__dot" aria-hidden="true" />}
      </span>
      {isToday && <span className="cal__badge">Today</span>}
      {hasData && !disabled && day.net !== null && (
        <>
          <span className="cal__amount" data-tone={formatMoney(day.net).tone}>
            <span className="cal__amount-full">
              {formatMoney(day.net).text}
            </span>
            <span className="cal__amount-compact">
              {formatCompactMoney(day.net)}
            </span>
          </span>
          <span className="cal__count">
            {count === 1 ? '1 trade' : `${count} trades`}
          </span>
        </>
      )}
      {hasData && !disabled && day.net === null && day.open > 0 && (
        <span className="cal__open">{day.open} open</span>
      )}
    </button>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** Decoration: the amounts carry the meaning. */
function Legend() {
  const steps = [
    'loss-3',
    'loss-2',
    'loss-1',
    'plain',
    'gain-1',
    'gain-2',
    'gain-3',
  ];
  return (
    <div className="legend" aria-hidden="true">
      <span>Loss</span>
      <span className="legend__swatches">
        {steps.map((s) => (
          <span key={s} className="legend__swatch" data-state={s} />
        ))}
      </span>
      <span>Profit</span>
    </div>
  );
}
