import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from 'react-oidc-context';
import { AuthView } from './AuthView.tsx';
import { withSymbols } from './testSymbols.ts';

vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const config = {
  region: 'ap-southeast-2',
  userPoolId: 'ap-southeast-2_AbCdEf123',
  userPoolClientId: 'client123',
  authDomain: 'https://example.auth.ap-southeast-2.amazoncognito.com',
  apiUrl: 'https://abc123defg.execute-api.ap-southeast-2.amazonaws.com',
};

const OCT = {
  from: '2026-10-01T04:00:00.000Z',
  to: '2026-11-01T04:00:00.000Z',
};
const NOV = {
  from: '2026-11-01T04:00:00.000Z',
  to: '2026-12-01T05:00:00.000Z',
};
const SEP = {
  from: '2026-09-01T04:00:00.000Z',
  to: '2026-10-01T04:00:00.000Z',
};

let signinRedirect = vi.fn();
function mockAuth() {
  signinRedirect = vi.fn();
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    signinRedirect,
    removeUser: vi.fn(),
    user: { access_token: 'tok', profile: { email: 'me@example.com' } },
  } as unknown as ReturnType<typeof useAuth>);
}

let seq = 0;
/** A TradeView as the API returns it. `net` undefined means still open. */
function trade(openedAt: string, net?: string) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    symbol: 'AAPL',
    instrumentType: 'stock',
    side: 'long',
    quantity: '1',
    entryPrice: '5',
    openedAt,
    fees: '0',
    createdAt: openedAt,
    updatedAt: openedAt,
    ...(net === undefined
      ? { metrics: {} }
      : { exitPrice: '6', closedAt: openedAt, metrics: { netPnl: net } }),
  };
}
const oct = (day: number, net?: string) =>
  trade(`2026-10-${String(day).padStart(2, '0')}T16:00:00.000Z`, net);

/** The fixture month: today is Fri 23 Oct 2026 in New York. */
function fixtureTrades() {
  return [
    oct(5, '600'),
    oct(6, '98.76'),
    oct(6, '-21.62'),
    oct(7, '-250'),
    oct(8), // open
    oct(12, '300.50'),
  ];
}

type Handler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A stubbed fetch that records every call and answers through `handler`. */
function stubFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  const gets = () => calls.filter((c) => (c.init?.method ?? 'GET') === 'GET');
  return { fetchFn, calls, gets };
}

/** Octobers fixture for any request; every other month is empty. */
const fixtureHandler: Handler = (url) =>
  json({
    items: url.searchParams.get('from') === OCT.from ? fixtureTrades() : [],
  });

const NOW = new Date('2026-10-23T16:00:15.000Z'); // 12:00 in New York

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mockAuth();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const renderShell = (fetchFn: typeof fetch) =>
  render(<AuthView config={config} fetchFn={withSymbols(fetchFn)} />);

/** A day button by its aria-label prefix, e.g. `Oct 5`. */
const day = (label: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^${label.replace(/ /g, '\\s')}:`),
  }) as HTMLButtonElement;

const panel = () =>
  screen.getByRole('region', { name: 'Daily profit and loss' });
const statCard = (name: string) =>
  screen.getByText(name, { selector: '.stat__name' }).parentElement!;
const weekList = () => screen.getByRole('list', { name: 'Weekly totals' });
const title = () => screen.getByRole('heading', { level: 1 }).textContent;
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const loaded = () =>
  waitFor(() => expect(panel().getAttribute('aria-busy')).toBe('false'));
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('first load', () => {
  it('loads the current New York month, one request per page, following nextCursor', async () => {
    const { fetchFn, gets } = stubFetch((url) =>
      url.searchParams.get('cursor') === 'c2'
        ? json({ items: [oct(6, '5')], nextCursor: 'c3' })
        : url.searchParams.get('cursor') === 'c3'
          ? json({ items: [oct(7, '5')] })
          : json({ items: [oct(5, '5')], nextCursor: 'c2' }),
    );
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(3));
    await loaded();
    expect(title()).toBe('October 2026');
    const calls = gets();
    expect(calls.map((c) => c.url.searchParams.get('cursor'))).toEqual([
      null,
      'c2',
      'c3',
    ]);
    for (const { url, init } of calls) {
      expect(url.origin + url.pathname).toBe(`${config.apiUrl}/trades`);
      expect(url.searchParams.get('from')).toBe(OCT.from);
      expect(url.searchParams.get('to')).toBe(OCT.to);
      expect(url.searchParams.get('limit')).toBe('100');
      expect(init?.headers).toEqual({ Authorization: 'Bearer tok' });
    }
    // All three pages show.
    expect(day('Oct 5').getAttribute('aria-label')).toContain('+$5.00');
    expect(day('Oct 6').getAttribute('aria-label')).toContain('+$5.00');
    expect(day('Oct 7').getAttribute('aria-label')).toContain('+$5.00');
    expect(statCard('Trades').textContent).toContain('3');
  });

  it('uses the New York month at 01:30 Melbourne on 1 Nov (still 31 Oct in New York)', async () => {
    // 2026-10-31T14:30Z is 01:30 on 1 Nov in Melbourne and 10:30 on the 31st in New York.
    vi.setSystemTime(new Date('2026-10-31T14:30:00.000Z'));
    const { fetchFn, gets } = stubFetch(() => json({ items: [] }));
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(1));
    expect(gets()[0]!.url.searchParams.get('from')).toBe(OCT.from);
    expect(title()).toBe('October 2026');
  });

  it('opens on the New York month even when UTC is already the next month', async () => {
    // 22:00 EDT on 31 Oct is 02:00Z on 1 Nov.
    vi.setSystemTime(new Date('2026-11-01T02:00:00.000Z'));
    const { fetchFn, gets } = stubFetch(() => json({ items: [] }));
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(1));
    expect(gets()[0]!.url.searchParams.get('to')).toBe(OCT.to);
  });
});

describe('fixture month', () => {
  async function renderFixture() {
    const api = stubFetch(fixtureHandler);
    renderShell(api.fetchFn);
    await loaded();
    return api;
  }

  it('shows day amounts and trade counts', async () => {
    await renderFixture();
    const d5 = day('Oct 5');
    expect(within(d5).getAllByText('+$600.00').length).toBeGreaterThan(0);
    expect(within(d5).getByText('1 trade')).toBeTruthy();
    const d6 = day('Oct 6');
    expect(within(d6).getAllByText('+$77.14').length).toBeGreaterThan(0);
    expect(within(d6).getByText('2 trades')).toBeTruthy();
    expect(
      within(day('Oct 7')).getAllByText('−$250.00').length,
    ).toBeGreaterThan(0);
    expect(
      within(day('Oct 12')).getAllByText('+$300.50').length,
    ).toBeGreaterThan(0);
  });

  it('shows the open-only day as "1 open", with no amount and no shade', async () => {
    await renderFixture();
    const d8 = day('Oct 8');
    expect(within(d8).getByText('1 open')).toBeTruthy();
    expect(within(d8).queryByText(/\$/)).toBeNull();
    expect(d8.getAttribute('data-state')).toBe('plain');
  });

  it('shades gain and loss days by step', async () => {
    await renderFixture();
    // max is 600: 77.14 x 3 <= 600 is step 1; 250 x 3 = 750 and 300.50 x 3 = 901.5 are <= 1200, step 2.
    expect(day('Oct 5').getAttribute('data-state')).toBe('gain-3');
    expect(day('Oct 12').getAttribute('data-state')).toBe('gain-2');
    expect(day('Oct 6').getAttribute('data-state')).toBe('gain-1');
    expect(day('Oct 7').getAttribute('data-state')).toBe('loss-2');
  });

  it('marks today with a badge and aria-current="date", and only today', async () => {
    await renderFixture();
    const today = day('Oct 23');
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(within(today).getByText('Today')).toBeTruthy();
    expect(panel().querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(day('Oct 22').getAttribute('aria-current')).toBeNull();
  });

  it('disables future days and outside days, with their labels', async () => {
    await renderFixture();
    expect(day('Oct 24').disabled).toBe(true);
    expect(day('Oct 24').getAttribute('aria-label')).toBe('Oct 24: not yet');
    expect(day('Oct 31').disabled).toBe(true);
    expect(day('Sep 28').disabled).toBe(true);
    expect(day('Sep 28').getAttribute('aria-label')).toBe(
      'Sep 28: outside this month',
    );
    expect(day('Nov 1').getAttribute('aria-label')).toBe(
      'Nov 1: outside this month',
    );
    expect(day('Oct 22').disabled).toBe(false);
    expect(day('Oct 23').disabled).toBe(false);
  });

  it('shows week totals in the list, counting only in-month days and open trades', async () => {
    await renderFixture();
    const items = within(weekList())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Week 1 · — · 0 trades',
      'Week 2 · +$427.14 · 5 trades',
      'Week 3 · +$300.50 · 1 trade',
      'Week 4 · — · 0 trades',
      'Week 5 · — · 0 trades',
    ]);
  });

  it('shows week totals in the grid column too', async () => {
    await renderFixture();
    const cells = [...panel().querySelectorAll('.cal__week')].map(
      (c) => c.textContent,
    );
    expect(cells).toHaveLength(5);
    expect(cells[1]).toContain('Week 2');
    expect(cells[1]).toContain('+$427.14');
    expect(cells[1]).toContain('5 trades');
    expect(cells[2]).toContain('+$300.50');
    expect(cells[0]).toContain('—');
  });

  it('shows the five stats', async () => {
    await renderFixture();
    const net = statCard('Net P&L').textContent!;
    expect(net).toContain('+$727.64');
    expect(net).toContain('October to date');
    const win = statCard('Day win rate').textContent!;
    expect(win).toContain('75%');
    expect(win).toContain('3 green · 1 red days');
    const trades = statCard('Trades').textContent!;
    expect(trades).toContain('6');
    expect(trades).toContain('5 trading days · 1 open');
    const best = statCard('Best day').textContent!;
    expect(best).toContain('+$600.00');
    expect(best).toContain('Oct 5');
    const worst = statCard('Worst day').textContent!;
    expect(worst).toContain('−$250.00');
    expect(worst).toContain('Oct 7');
  });

  it('every in-month day with trades has an accessible name with its exact amount', async () => {
    await renderFixture();
    const expected: Record<string, string> = {
      'Oct 5': '+$600.00',
      'Oct 6': '+$77.14',
      'Oct 7': '−$250.00',
      'Oct 12': '+$300.50',
    };
    for (const [label, amount] of Object.entries(expected)) {
      expect(day(label).getAttribute('aria-label')).toContain(amount);
      expect(
        screen.getByRole('button', {
          name: new RegExp(
            `^${label}:.*\\${amount.slice(0, 1) === '+' ? '+' : '−'}`,
          ),
        }),
      ).toBeTruthy();
    }
    expect(day('Oct 8').getAttribute('aria-label')).toContain('1 open');
    // Every enabled in-month button has an informative name.
    const inMonth = within(panel())
      .getAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(inMonth.length).toBe(23);
    for (const b of inMonth) {
      expect(b.getAttribute('aria-label') ?? '').toMatch(/^Oct \d+: /);
    }
  });

  it('has a Calendar nav item and weekday headers with full names', async () => {
    await renderFixture();
    const names = [...panel().querySelectorAll('abbr')].map((a) =>
      a.getAttribute('title'),
    );
    expect(names).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });
});

describe('money formatting', () => {
  // system.md: money has sign, $, thousands separators and two decimals.
  it('shows thousands separators in day labels, week totals and stats', async () => {
    const { fetchFn } = stubFetch((url) =>
      json({
        items:
          url.searchParams.get('from') === OCT.from
            ? [oct(12, '1250.50'), oct(13, '-2000')]
            : [],
      }),
    );
    renderShell(fetchFn);
    await loaded();
    expect(day('Oct 12').getAttribute('aria-label')).toContain('+$1,250.50');
    expect(day('Oct 13').getAttribute('aria-label')).toContain('−$2,000.00');
    expect(weekList().textContent).toContain('Week 3 · −$749.50 · 2 trades');
    expect(statCard('Net P&L').textContent).toContain('−$749.50');
    expect(statCard('Best day').textContent).toContain('+$1,250.50');
  });
});

describe('navigation', () => {
  it('‹, › and Today fetch the right month ranges', async () => {
    const { fetchFn, gets } = stubFetch(() => json({ items: [] }));
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(1));
    const lastRange = () => {
      const g = gets();
      const { searchParams } = g[g.length - 1]!.url;
      return { from: searchParams.get('from'), to: searchParams.get('to') };
    };

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(gets()).toHaveLength(2));
    expect(lastRange()).toEqual(NOV);
    expect(title()).toBe('November 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(gets().length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(lastRange()).toEqual(SEP));
    expect(title()).toBe('September 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(lastRange()).toEqual(OCT));
    expect(title()).toBe('October 2026');
  });

  it('› from December goes to January of the next year, ‹ from January goes back', async () => {
    const { fetchFn, gets } = stubFetch(() => json({ items: [] }));
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(1));
    const next = screen.getByRole('button', { name: 'Next month' });
    fireEvent.click(next); // Nov
    fireEvent.click(next); // Dec
    fireEvent.click(next); // Jan 2027
    await waitFor(() => expect(title()).toBe('January 2027'));
    await waitFor(() =>
      expect(gets().at(-1)!.url.searchParams.get('from')).toBe(
        '2027-01-01T05:00:00.000Z',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(title()).toBe('December 2026'));
    await waitFor(() => {
      const u = gets().at(-1)!.url.searchParams;
      expect([u.get('from'), u.get('to')]).toEqual([
        '2026-12-01T05:00:00.000Z',
        '2027-01-01T05:00:00.000Z',
      ]);
    });
  });

  it('a future month shows every day disabled and "context" for a past month on return', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByText(/No trades in November/);
    const enabled = within(panel())
      .getAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(0);
    // Back in October the stat is "to date"; once today is in November it would not be.
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() =>
      expect(statCard('Net P&L').textContent).toContain('October to date'),
    );
  });

  it('shows a past month with the "October 2026" context after the clock moves on', async () => {
    vi.setSystemTime(new Date('2026-11-23T17:00:00.000Z'));
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(title()).toBe('October 2026'));
    await waitFor(() =>
      expect(statCard('Net P&L').textContent).toContain('+$727.64'),
    );
    expect(statCard('Net P&L').textContent).toContain('October 2026');
    expect(statCard('Net P&L').textContent).not.toContain('to date');
    // Every October day through the 31st is in the past, so all are enabled.
    expect(day('Oct 31').disabled).toBe(false);
  });
});

describe('stale responses', () => {
  it('ignores a slow previous month that resolves after moving on', async () => {
    const slowOct = deferred<Response>();
    const { fetchFn, gets } = stubFetch((url) =>
      url.searchParams.get('from') === OCT.from
        ? (slowOct.promise as unknown as Response)
        : json({ items: [] }),
    );
    renderShell(fetchFn);
    await waitFor(() => expect(gets()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByText(/No trades in November/);

    await act(async () => {
      slowOct.resolve(json({ items: fixtureTrades() }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(title()).toBe('November 2026');
    expect(screen.getByText(/No trades in November/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('600.00');
    expect(document.body.textContent).not.toContain('727.64');
    expect(statCard('Trades').textContent).not.toContain('6');
  });

  it('never shows the previous month under the new title while the new month loads', async () => {
    const slowNov = deferred<Response>();
    const { fetchFn, gets } = stubFetch((url) =>
      url.searchParams.get('from') === NOV.from
        ? (slowNov.promise as unknown as Response)
        : fixtureHandler(url, undefined),
    );
    renderShell(fetchFn);
    await loaded();
    expect(document.body.textContent).toContain('727.64');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(gets()).toHaveLength(2));
    expect(title()).toBe('November 2026');
    expect(panel().getAttribute('aria-busy')).toBe('true');
    expect(document.body.textContent).not.toContain('600.00');
    expect(document.body.textContent).not.toContain('727.64');
    await act(async () => {
      slowNov.resolve(json({ items: [] }));
    });
    await screen.findByText(/No trades in November/);
  });

  it('aborts the previous month request when moving on', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const { fetchFn } = stubFetch((url, init) => {
      signals.push(init?.signal);
      return url.searchParams.get('from') === OCT.from
        ? (new Promise<Response>(() => {}) as unknown as Response)
        : json({ items: [] });
    });
    renderShell(fetchFn);
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => expect(signals[0]!.aborted).toBe(true));
  });
});

describe('states', () => {
  it('while loading: aria-busy, no amounts, stats are dashes', async () => {
    const pending = deferred<Response>();
    const { fetchFn } = stubFetch(() => pending.promise as unknown as Response);
    renderShell(fetchFn);
    expect(panel().getAttribute('aria-busy')).toBe('true');
    expect(title()).toBe('October 2026');
    expect(within(panel()).queryByText(/\$/)).toBeNull();
    for (const name of [
      'Net P&L',
      'Day win rate',
      'Trades',
      'Best day',
      'Worst day',
    ]) {
      expect(statCard(name).querySelector('.stat__value')!.textContent).toBe(
        '—',
      );
    }
    // The grid still draws its days.
    expect(within(panel()).getAllByRole('button').length).toBe(35);
    await act(async () => {
      pending.resolve(json({ items: fixtureTrades() }));
    });
    await loaded();
    expect(within(panel()).getAllByText('+$600.00').length).toBeGreaterThan(0);
  });

  it('empty month: copy, dashes, and a Log a trade button that opens the dialog', async () => {
    const { fetchFn } = stubFetch(() => json({ items: [] }));
    renderShell(fetchFn);
    await screen.findByText(/No trades in October\./);
    expect(statCard('Net P&L').textContent).toContain(
      'No trades in October. Log a trade',
    );
    expect(statCard('Day win rate').textContent).toContain('No closed trades');
    expect(statCard('Trades').textContent).toContain('No trading days');
    expect(statCard('Best day').textContent).toContain('No winning days');
    expect(statCard('Worst day').textContent).toContain('No losing days');
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Log a trade' }));
    expect(screen.getByRole('button', { name: 'Save trade' })).toBeTruthy();
  });

  it('open-only month: shows the Trades count and no "No trades in" copy', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.get('from') === OCT.from
        ? json({ items: [oct(5), oct(6)] })
        : json({ items: [] }),
    );
    renderShell(fetchFn);
    await loaded();
    expect(screen.queryByText(/No trades in October/)).toBeNull();
    expect(statCard('Trades').textContent).toContain('2');
    expect(statCard('Trades').textContent).toContain('2 trading days · 2 open');
    expect(statCard('Net P&L').textContent).toContain('—');
    expect(statCard('Net P&L').textContent).toContain('No closed trades yet');
    expect(
      statCard('Day win rate').querySelector('.stat__value')!.textContent,
    ).toBe('—');
  });

  it.each([
    ['a 500', () => json({ message: 'boom' }, 500)],
    ['a 400', () => json({ message: 'bad' }, 400)],
    ['a bad body', () => json({ nope: true })],
    ['bad JSON', () => new Response('<html>', { status: 200 })],
  ])('%s shows the error alert; Retry fetches again', async (_n, failing) => {
    let fail = true;
    const { fetchFn, gets } = stubFetch((url) =>
      fail ? failing() : fixtureHandler(url, undefined),
    );
    renderShell(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Couldn’t load your trades. Check your connection and try again.',
    );
    expect(within(alert).queryByRole('button', { name: 'Sign in' })).toBeNull();
    // The grid stays visible behind the alert, with no amounts.
    expect(within(panel()).getAllByRole('button').length).toBe(35);
    expect(within(panel()).queryByText(/\$/)).toBeNull();
    expect(gets()).toHaveLength(1);

    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(gets()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(within(panel()).getAllByText('+$600.00').length).toBeGreaterThan(0);
  });

  it('a network failure shows the error alert', async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    renderShell(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load your trades');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('a 401 shows the session alert whose Sign in button starts sign-in', async () => {
    const { fetchFn } = stubFetch(() => json({ message: 'Unauthorized' }, 401));
    renderShell(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Your session has expired. Sign in again.',
    );
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(signinRedirect).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Sign in' }));
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it('shows the error state when a month has more than 50 pages', async () => {
    let n = 0;
    const { fetchFn, gets } = stubFetch(() => {
      n += 1;
      return json({ items: [oct(5, '1')], nextCursor: `c${n}` });
    });
    renderShell(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load your trades');
    expect(gets()).toHaveLength(50);
    expect(within(panel()).queryByText(/\$/)).toBeNull();
  });

  it('exactly 50 pages still loads', async () => {
    let n = 0;
    const { fetchFn, gets } = stubFetch(() => {
      n += 1;
      return n < 50
        ? json({ items: [], nextCursor: `c${n}` })
        : json({ items: [oct(5, '1')] });
    });
    renderShell(fetchFn);
    await loaded();
    expect(gets()).toHaveLength(50);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(day('Oct 5').getAttribute('aria-label')).toContain('+$1.00');
  });
});

describe('clicking a day', () => {
  it('a past day opens the dialog with 09:30 New York on that date', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(day('Oct 6'));
    expect(screen.getByRole('button', { name: 'Save trade' })).toBeTruthy();
    // TZ=America/New_York, so the local value is the New York wall clock.
    expect(field('Entry time').value).toBe('2026-10-06T09:30');
  });

  it('an empty past day does the same', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(day('Oct 14'));
    expect(field('Entry time').value).toBe('2026-10-14T09:30');
  });

  it('a past day in a past month still uses its own date', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(title()).toBe('September 2026'));
    await waitFor(() =>
      expect(panel().getAttribute('aria-busy')).toBe('false'),
    );
    fireEvent.click(day('Sep 30'));
    expect(field('Entry time').value).toBe('2026-09-30T09:30');
  });

  it('today uses now, not 09:30', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(day('Oct 23'));
    expect(field('Entry time').value).toBe('2026-10-23T12:00');
  });

  it('future and outside days do nothing when clicked', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(day('Oct 24'));
    fireEvent.click(day('Sep 28'));
    fireEvent.click(day('Nov 1'));
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
  });

  it('the top bar New trade button uses now', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'New trade' }));
    expect(field('Entry time').value).toBe('2026-10-23T12:00');
  });
});

describe('saving a trade', () => {
  function saveHandler(secondGet: Promise<Response>) {
    let gets = 0;
    const handler: Handler = (_url, init) => {
      if (init?.method === 'POST') {
        return json(
          { ...oct(6, undefined), openedAt: '2026-10-06T13:30:00.000Z' },
          201,
        );
      }
      gets += 1;
      return gets === 1
        ? json({ items: fixtureTrades() })
        : (secondGet as unknown as Response);
    };
    return handler;
  }

  it('closes the dialog, toasts, refetches, keeps old figures meanwhile, and returns focus', async () => {
    const refetch = deferred<Response>();
    const { fetchFn, gets, calls } = stubFetch(saveHandler(refetch.promise));
    renderShell(fetchFn);
    await loaded();
    const opener = day('Oct 6');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.change(field('Symbol'), { target: { value: 'AAPL' } });
    fireEvent.change(field('Qty'), { target: { value: '1' } });
    fireEvent.change(field('Entry'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));

    await screen.findByText('Trade saved');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
    await waitFor(() => expect(gets()).toHaveLength(2));
    // Same month, same range.
    expect(gets()[1]!.url.searchParams.get('from')).toBe(OCT.from);
    expect(gets()[1]!.url.searchParams.get('to')).toBe(OCT.to);

    // The old figures stay while the refetch is pending.
    expect(panel().getAttribute('aria-busy')).toBe('false');
    expect(within(panel()).getAllByText('+$600.00').length).toBeGreaterThan(0);
    expect(statCard('Net P&L').textContent).toContain('+$727.64');

    await act(async () => {
      refetch.resolve(json({ items: [...fixtureTrades(), oct(14, '100')] }));
    });
    await waitFor(() =>
      expect(statCard('Net P&L').textContent).toContain('+$827.64'),
    );
    expect(opener.isConnected).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('a failed refetch after saving shows the error alert, not stale figures', async () => {
    let gets = 0;
    const { fetchFn } = stubFetch((_url, init) => {
      if (init?.method === 'POST') return json(oct(6), 201);
      gets += 1;
      return gets === 1
        ? json({ items: fixtureTrades() })
        : json({ message: 'boom' }, 500);
    });
    renderShell(fetchFn);
    await loaded();
    fireEvent.click(day('Oct 6'));
    fireEvent.change(field('Symbol'), { target: { value: 'AAPL' } });
    fireEvent.change(field('Qty'), { target: { value: '1' } });
    fireEvent.change(field('Entry'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load your trades');
    await settle();
    expect(within(panel()).queryByText('+$600.00')).toBeNull();
  });
});

describe('review fixes', () => {
  it('a future day with trades shows its amount and count, and can log a trade', async () => {
    const future = oct(28, '250.25');
    const { fetchFn } = stubFetch((url) =>
      json({
        items:
          url.searchParams.get('from') === OCT.from
            ? [...fixtureTrades(), future]
            : [],
      }),
    );
    renderShell(fetchFn);
    await loaded();
    const cell = day('Oct 28');
    expect(cell.disabled).toBe(false);
    expect(cell.getAttribute('aria-label')).toBe('Oct 28: +$250.25, 1 trade');
    expect(within(cell).getAllByText('+$250.25').length).toBeGreaterThan(0);
    expect(within(cell).getByText('1 trade')).toBeTruthy();
    // Neighbours without trades stay disabled.
    expect(day('Oct 27').disabled).toBe(true);
    fireEvent.click(cell);
    expect(field('Entry time').value).toBe('2026-10-28T09:30');
  });

  it('today shows a decorative dot beside its number', async () => {
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    const dot = day('Oct 23').querySelector('.cal__dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(panel().querySelectorAll('.cal__dot')).toHaveLength(1);
  });

  it('a sub-cent day is breakeven and unshaded', async () => {
    const { fetchFn } = stubFetch((url) =>
      json({
        items:
          url.searchParams.get('from') === OCT.from
            ? [oct(6, '0.004'), oct(7, '10')]
            : [],
      }),
    );
    renderShell(fetchFn);
    await loaded();
    expect(day('Oct 6').getAttribute('aria-label')).toBe(
      'Oct 6: $0.00, 1 trade',
    );
    expect(day('Oct 6').getAttribute('data-state')).toBe('plain');
    expect(within(day('Oct 6')).getByText('0')).toBeTruthy();
  });

  it('a malformed netPnl shows the error state with Retry, not a crash', async () => {
    const { fetchFn } = stubFetch(() =>
      json({ items: [oct(6, 'not-a-number')] }),
    );
    renderShell(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('does not bring back a failure alert when returning to the month', async () => {
    const slowOct = deferred<Response>();
    let octCalls = 0;
    const { fetchFn } = stubFetch((url) => {
      if (url.searchParams.get('from') !== OCT.from) return json({ items: [] });
      octCalls += 1;
      return octCalls === 1
        ? json({ message: 'boom' }, 500)
        : (slowOct.promise as unknown as Response);
    });
    renderShell(fetchFn);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByText(/No trades in November/);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(octCalls).toBe(2));
    expect(title()).toBe('October 2026');
    expect(panel().getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      slowOct.resolve(json({ items: fixtureTrades() }));
    });
    await loaded();
  });

  it('announces Loading… in a status outside the busy section, then clears it', async () => {
    const pending = deferred<Response>();
    const { fetchFn } = stubFetch(() => pending.promise as unknown as Response);
    renderShell(fetchFn);
    const status = screen
      .getAllByRole('status')
      .find((el) => el.textContent === 'Loading…')!;
    expect(status.textContent).toBe('Loading…');
    expect(panel().contains(status)).toBe(false);
    await act(async () => {
      pending.resolve(json({ items: fixtureTrades() }));
    });
    await loaded();
    expect(status.isConnected).toBe(true);
    expect(status.textContent).toBe('');
  });
});

describe('New York midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves today to the next day while the page stays open, and keeps the month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T03:59:30.000Z')); // 23:59:30 Fri
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(day('Oct 23').getAttribute('aria-current')).toBe('date');
    expect(day('Oct 24').disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(day('Oct 24').getAttribute('aria-current')).toBe('date');
    expect(day('Oct 23').getAttribute('aria-current')).toBeNull();
    expect(day('Oct 24').disabled).toBe(false);
    expect(title()).toBe('October 2026');
  });

  it('rolls into a new month without moving the shown month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T03:59:30.000Z')); // 31 Oct 23:59:30
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(title()).toBe('October 2026');
    expect(
      screen.getByText('October 2026', { selector: '.stat__context' }),
    ).toBeTruthy();
  });

  it('re-reads the clock when the window gets focus after a sleep', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T16:00:00.000Z'));
    const { fetchFn } = stubFetch(fixtureHandler);
    renderShell(fetchFn);
    await loaded();
    expect(day('Oct 23').getAttribute('aria-current')).toBe('date');
    vi.setSystemTime(new Date('2026-10-24T16:00:00.000Z'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(day('Oct 24').getAttribute('aria-current')).toBe('date');
  });
});
