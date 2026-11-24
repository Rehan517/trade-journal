import { useEffect, useRef, useState } from 'react';
import type { TradeView } from '@trade-journal/shared';
import { ApiError, listTrades } from './api.ts';
import {
  formatMoney,
  formatOpened,
  formatR,
  formatShortDate,
  formatTimeOfDay,
  type Tone,
} from './format.ts';

const PAGE_SIZE = 25;

type Failure = 'session' | 'network';

interface Loaded {
  rows: TradeView[];
  /** Set only while the last page had a cursor and at least one trade. */
  cursor: string | undefined;
}

type More =
  { state: 'idle' } | { state: 'loading' } | { state: 'error'; kind: Failure };

const failureOf = (err: unknown): Failure =>
  err instanceof ApiError && err.status === 401 ? 'session' : 'network';

interface Cells {
  id: string;
  trade: TradeView;
  /** "long trade, Nov 19 · 09:41": the end of the row buttons' names. */
  nameTail: string;
  opened: { iso: string; text: string; date: string; time: string };
  symbol: string;
  side: string;
  quantity: string;
  pnl: { text: string; tone: Tone } | null;
  r: { text: string; tone: Tone } | null;
  open: boolean;
}

function cellsOf(trade: TradeView, year: number): Cells {
  const net = trade.metrics.netPnl;
  const r = trade.metrics.rMultiple;
  return {
    id: trade.id,
    trade,
    nameTail: `${trade.symbol} ${trade.side} trade, ${formatOpened(trade.openedAt, year)}`,
    opened: {
      iso: trade.openedAt,
      text: formatOpened(trade.openedAt, year),
      date: formatShortDate(trade.openedAt, year),
      time: formatTimeOfDay(trade.openedAt),
    },
    symbol: trade.symbol,
    side: trade.side === 'long' ? '▲ Long' : '▼ Short',
    quantity: trade.quantity,
    pnl: net === undefined ? null : formatMoney(net),
    r: net === undefined || r === undefined ? null : formatR(r),
    open: net === undefined,
  };
}

export function TradesPage({
  apiUrl,
  accessToken,
  onSignIn,
  fetchFn,
  now = () => new Date(),
  onLogTrade,
  onOpenTrade,
  refreshKey = 0,
}: {
  apiUrl: string;
  accessToken: string | undefined;
  /** Starts sign-in again, for the "session expired" alert. */
  onSignIn: () => void;
  /** Used for the API calls; replaceable in tests. */
  fetchFn?: typeof fetch;
  /** The clock, for "the current year"; replaceable in tests. */
  now?: () => Date;
  /** The trader wants to log a trade; `opener` gets focus back afterwards. */
  onLogTrade: (
    initialOpenedAt: string | undefined,
    opener: HTMLElement,
  ) => void;
  /**
   * The trader chose a row: its symbol edits the trade, and Close on an open
   * trade closes it. `opener` gets focus back afterwards.
   */
  onOpenTrade: (
    trade: TradeView,
    mode: 'edit' | 'close',
    opener: HTMLElement,
  ) => void;
  /** Bumped by the parent after a save or a delete; the first page is fetched again. */
  refreshKey?: number;
}) {
  const [retries, setRetries] = useState(0);
  const attempt = `${refreshKey}:${retries}`;
  // The shown list stays while a refresh is in flight, so a save doesn't
  // blank the page; the refreshed first page replaces it on arrival.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{
    attempt: string;
    kind: Failure;
  } | null>(null);
  const [more, setMore] = useState<More>({ state: 'idle' });
  const moreAbort = useRef<AbortController | null>(null);
  // Requests read the token from here, so a silent renewal (a new token
  // string) doesn't reload the list. Only missing-to-present refetches.
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  });
  const hasToken = Boolean(accessToken);
  // Bumped by every first-page request; a Load more from an older one is stale.
  const generation = useRef(0);
  // The attempt whose first-page request has settled. Until it matches, a
  // refresh is in flight and Load more is inert.
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    const token = tokenRef.current;
    if (!hasToken || !token) {
      // Defer: state changes inside the effect body would cascade a render.
      const id = setTimeout(() => {
        setLoaded(null);
        setFailed({ attempt, kind: 'session' });
        setSettled(attempt);
      }, 0);
      return () => clearTimeout(id);
    }
    // Leaving the page or refetching aborts this, so a slow response can't
    // land late.
    const controller = new AbortController();
    listTrades(
      apiUrl,
      token,
      { limit: PAGE_SIZE },
      fetchFn,
      controller.signal,
    ).then(
      (page) => {
        if (controller.signal.aborted) return;
        moreAbort.current?.abort();
        setSettled(attempt);
        setFailed(null);
        setMore({ state: 'idle' });
        setLoaded({
          rows: page.items,
          cursor: page.items.length > 0 ? page.nextCursor : undefined,
        });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        moreAbort.current?.abort();
        setSettled(attempt);
        setLoaded(null);
        setMore({ state: 'idle' });
        setFailed({ attempt, kind: failureOf(err) });
      },
    );
    return () => {
      controller.abort();
      moreAbort.current?.abort();
      setFailed(null);
    };
  }, [apiUrl, hasToken, fetchFn, attempt]);

  const refreshing = settled !== attempt;
  const failure = failed && failed.attempt === attempt ? failed.kind : null;
  const rows = failure ? null : (loaded?.rows ?? null);
  const loading = rows === null && failure === null;
  const cursor = failure ? undefined : loaded?.cursor;
  const year = now().getFullYear();

  // Focus: after Load more it stays on the button. If the button goes away
  // it moves to the first new row; after a save from the empty state, the
  // opener is gone, so focus goes to the title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const focusFrom = useRef<number | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openerTrade = useRef<string | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from !== null && !cursor && rows && rows.length > 0) {
      focusFrom.current = null;
      const target = rows[Math.min(from, rows.length - 1)];
      // The table and the cards both exist; only the visible one takes focus.
      for (const el of panelRef.current?.querySelectorAll<HTMLElement>(
        '[data-row]',
      ) ?? []) {
        if (el.dataset.row !== target?.id) continue;
        el.focus();
        if (document.activeElement === el) break;
      }
    }
    const opener = openerRef.current;
    if (opener && !opener.isConnected) {
      openerRef.current = null;
      const id = openerTrade.current;
      openerTrade.current = null;
      if (
        document.activeElement === document.body ||
        document.activeElement === null
      ) {
        // Close went away with the trade's open status: the same trade's
        // symbol button is the next best place. If the reload dropped the
        // trade altogether, the title is.
        let focused = false;
        for (const el of panelRef.current?.querySelectorAll<HTMLElement>(
          '[data-edit]',
        ) ?? []) {
          if (el.dataset.edit !== id) continue;
          el.focus();
          if (document.activeElement === el) {
            focused = true;
            break;
          }
        }
        if (!focused) titleRef.current?.focus();
      }
    }
  }, [rows, cursor]);

  // The Load more button is replaced by the alert on failure; keep focus on
  // its Retry so a keyboard user keeps their place.
  const moreActionRef = useRef<HTMLButtonElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (more.state === 'error') {
      moreActionRef.current?.focus();
    } else if (
      more.state === 'loading' &&
      (document.activeElement === document.body ||
        document.activeElement === null)
    ) {
      // Retry was replaced by the Load more button; focus follows it.
      loadMoreRef.current?.focus();
    }
  }, [more.state]);

  const openTrade = (
    trade: TradeView,
    mode: 'edit' | 'close',
    opener: HTMLElement,
  ) => {
    openerRef.current = opener;
    openerTrade.current = trade.id;
    onOpenTrade(trade, mode, opener);
  };

  const logTrade = (initial: string | undefined, opener: HTMLElement) => {
    openerRef.current = opener;
    onLogTrade(initial, opener);
  };

  const loadMore = () => {
    const token = tokenRef.current;
    if (!token || !loaded?.cursor || refreshing || more.state === 'loading') {
      return;
    }
    const { cursor: at, rows: current } = loaded;
    const started = generation.current;
    const controller = new AbortController();
    moreAbort.current?.abort();
    moreAbort.current = controller;
    setMore({ state: 'loading' });
    listTrades(
      apiUrl,
      token,
      { limit: PAGE_SIZE, cursor: at },
      fetchFn,
      controller.signal,
    ).then(
      (page) => {
        if (controller.signal.aborted || started !== generation.current) return;
        const next = page.items.length > 0 ? page.nextCursor : undefined;
        // Focus moves to the first new row only if the button goes away.
        focusFrom.current = next ? null : current.length;
        setMore({ state: 'idle' });
        setLoaded({ rows: [...current, ...page.items], cursor: next });
      },
      (err: unknown) => {
        if (controller.signal.aborted || started !== generation.current) return;
        setMore({ state: 'error', kind: failureOf(err) });
      },
    );
  };

  const cells = (rows ?? []).map((trade) => cellsOf(trade, year));
  const empty = rows !== null && rows.length === 0;

  return (
    <div className="trades">
      <h1 className="trades__title" ref={titleRef} tabIndex={-1}>
        Trades
      </h1>

      {failure && (
        <div className="alert trades__alert" role="alert">
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

      <p className="sr-only" role="status">
        {loading ? 'Loading…' : ''}
      </p>

      <section
        className={`trades__panel${empty ? ' trades__panel--empty' : ''}`}
        aria-label="Trades"
        aria-busy={loading}
        ref={panelRef}
      >
        {empty ? (
          <div className="trades__empty">
            <p>No trades yet.</p>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={(e) => logTrade(undefined, e.currentTarget)}
            >
              Log a trade
            </button>
          </div>
        ) : (
          <>
            <table className="trades__table">
              <caption className="sr-only">
                Your trades, newest first. Choose a symbol to edit.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Opened</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="num trades__qty">
                    Qty
                  </th>
                  <th scope="col" className="num">
                    Net P&amp;L
                  </th>
                  <th scope="col" className="num">
                    R
                  </th>
                  <th scope="col" className="trades__status">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={c.id} data-row={c.id} tabIndex={-1}>
                    <td className="trades__opened">
                      <time dateTime={c.opened.iso}>
                        <span className="trades__date">{c.opened.date}</span>
                        <span className="trades__sep"> · </span>
                        <span className="trades__time">{c.opened.time}</span>
                      </time>
                    </td>
                    <td className="trades__symbol">
                      <button
                        type="button"
                        className="trades__edit"
                        data-edit={c.id}
                        aria-label={`Edit ${c.nameTail}`}
                        onClick={(e) =>
                          openTrade(c.trade, 'edit', e.currentTarget)
                        }
                      >
                        {c.symbol}
                      </button>
                    </td>
                    <td>{c.side}</td>
                    <td className="num trades__qty">{c.quantity}</td>
                    <td
                      className="num trades__fig"
                      data-tone={c.pnl?.tone ?? 'muted'}
                    >
                      {c.pnl?.text ?? '—'}
                    </td>
                    <td
                      className="num trades__fig"
                      data-tone={c.r?.tone ?? 'muted'}
                    >
                      {c.r?.text ?? '—'}
                    </td>
                    <td className="trades__status">
                      <Status open={c.open} />
                      {c.open && (
                        <CloseButton
                          label={`Close ${c.nameTail}`}
                          onClick={(el) => openTrade(c.trade, 'close', el)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cells.length > 0 && (
              <ol className="trades__cards" aria-label="Your trades">
                {cells.map((c) => (
                  <li
                    key={c.id}
                    className="tcard"
                    data-row={c.id}
                    tabIndex={-1}
                  >
                    <div className="tcard__line">
                      <span className="tcard__lead">
                        <button
                          type="button"
                          className="trades__edit trades__symbol"
                          data-edit={c.id}
                          aria-label={`Edit ${c.nameTail}`}
                          onClick={(e) =>
                            openTrade(c.trade, 'edit', e.currentTarget)
                          }
                        >
                          {c.symbol}
                        </button>
                        <span>{c.side}</span>
                        {c.open && (
                          <>
                            <Status open />
                            <CloseButton
                              label={`Close ${c.nameTail}`}
                              onClick={(el) => openTrade(c.trade, 'close', el)}
                            />
                          </>
                        )}
                      </span>
                      <span
                        className="tcard__fig"
                        data-tone={c.pnl?.tone ?? 'muted'}
                      >
                        {c.pnl?.text ?? '—'}
                      </span>
                    </div>
                    <div className="tcard__line tcard__line--sub">
                      <span>
                        <time dateTime={c.opened.iso}>{c.opened.text}</time>
                        {' · '}
                        <span className="trades__qty-mono">{c.quantity}</span>
                      </span>
                      <span
                        className="tcard__fig"
                        data-tone={c.r?.tone ?? 'muted'}
                      >
                        {c.r?.text ?? '—'}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>

      {more.state === 'error' && (
        <div className="alert trades__alert" role="alert">
          {more.kind === 'session' ? (
            <>
              <p>Your session has expired. Sign in again.</p>
              <button
                type="button"
                className="btn btn--ghost"
                ref={moreActionRef}
                onClick={onSignIn}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <p>
                Couldn&rsquo;t load more trades. Check your connection and try
                again.
              </p>
              <button
                type="button"
                className="btn btn--quiet"
                ref={moreActionRef}
                aria-disabled={refreshing}
                onClick={loadMore}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {cursor && more.state !== 'error' && (
        <button
          type="button"
          className="btn btn--ghost trades__more"
          ref={loadMoreRef}
          aria-disabled={more.state === 'loading' || refreshing}
          aria-busy={more.state === 'loading'}
          onClick={loadMore}
        >
          {more.state === 'loading' ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function Status({ open }: { open: boolean }) {
  return open ? (
    <span className="badge badge--open">Open</span>
  ) : (
    <span className="trades__closed">Closed</span>
  );
}

/** Quiet, `--link`, and above the row's stretched edit button. */
function CloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn--quiet trades__close"
      aria-label={label}
      onClick={(e) => onClick(e.currentTarget)}
    >
      Close
    </button>
  );
}
