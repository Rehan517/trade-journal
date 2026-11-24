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
import { TradesPage } from './TradesPage.tsx';

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
const NARROW_NBSP = ' ';
const MINUS = '−';
const NOW = new Date('2026-11-23T15:00:00.000Z');

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
interface Opts {
  symbol?: string;
  side?: 'long' | 'short';
  quantity?: string;
  openedAt?: string;
  net?: string;
  r?: string;
  future?: boolean;
}
/** A TradeView as the API returns it. No `net` means still open. */
function trade(o: Opts = {}) {
  seq += 1;
  const openedAt = o.openedAt ?? '2026-11-19T14:41:00.000Z';
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    symbol: o.symbol ?? 'AAPL',
    instrumentType: o.future ? 'future' : 'stock',
    ...(o.future ? { pointValue: '5' } : {}),
    side: o.side ?? 'long',
    quantity: o.quantity ?? '1',
    entryPrice: '5',
    openedAt,
    fees: '0',
    createdAt: openedAt,
    updatedAt: openedAt,
    ...(o.net === undefined
      ? { metrics: {} }
      : {
          exitPrice: '6',
          closedAt: openedAt,
          metrics: {
            netPnl: o.net,
            ...(o.r === undefined ? {} : { rMultiple: o.r }),
          },
        }),
  };
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/trades');
  mockAuth();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

function renderPage(
  fetchFn: typeof fetch,
  extra: Partial<React.ComponentProps<typeof TradesPage>> = {},
) {
  const onSignIn = vi.fn();
  const onLogTrade = vi.fn();
  const utils = render(
    <TradesPage
      apiUrl={config.apiUrl}
      accessToken="tok"
      onSignIn={onSignIn}
      onLogTrade={onLogTrade}
      onOpenTrade={vi.fn()}
      fetchFn={fetchFn}
      {...extra}
    />,
  );
  return { ...utils, onSignIn, onLogTrade };
}

const bodyRows = () =>
  within(screen.getByRole('table')).getAllByRole('row').slice(1);
const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);
const timeOf = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

describe('first request', () => {
  it('asks GET /trades?limit=25 with the bearer token and no from/to', async () => {
    const { fetchFn, gets } = stubFetch(() => json({ items: [trade()] }));
    renderPage(fetchFn);
    await screen.findByRole('table');
    expect(gets()).toHaveLength(1);
    const { url, init } = gets()[0]!;
    expect(url.pathname).toBe('/trades');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.has('cursor')).toBe(false);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });
});

describe('rows and columns', () => {
  const items = () => [
    trade({
      symbol: 'AAPL',
      net: '98.76',
      r: '1.98',
      quantity: '50',
      openedAt: '2026-11-19T14:41:00.000Z',
    }),
    trade({ symbol: 'TSLA', net: '-21.62', r: '-1.08' }),
    trade({ symbol: 'IBM', net: '0', r: '0' }),
    trade({ symbol: 'NVDA' }),
    trade({ symbol: 'AMD', net: '10.00' }),
    trade({ symbol: 'MES', future: true, quantity: '2', net: '5' }),
    trade({ symbol: 'MNQ', side: 'short', net: '1' }),
  ];

  async function setup() {
    const data = items();
    const { fetchFn } = stubFetch(() => json({ items: data }));
    renderPage(fetchFn);
    await screen.findByRole('table');
    await waitFor(() => expect(bodyRows()).toHaveLength(data.length));
    return { data, rows: bodyRows() };
  }

  it('renders rows in API order', async () => {
    const { rows } = await setup();
    expect(rows.map((r) => cellsOf(r)[1])).toEqual([
      'AAPL',
      'TSLA',
      'IBM',
      'NVDA',
      'AMD',
      'MES',
      'MNQ',
    ]);
  });

  it('formats a closed win', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[0]!);
    expect(c[0]).toBe(`Nov 19 · ${timeOf('2026-11-19T14:41:00.000Z')}`);
    expect(c[0]).toContain('09:41');
    expect(c.slice(1)).toEqual([
      'AAPL',
      '▲ Long',
      '50',
      '+$98.76',
      `+1.98${NARROW_NBSP}R`,
      'Closed',
    ]);
  });

  it('formats a closed loss with a true minus sign', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[1]!);
    expect(c[4]).toBe(`${MINUS}$21.62`);
    expect(c[5]).toBe(`${MINUS}1.08${NARROW_NBSP}R`);
    expect(c[6]).toBe('Closed');
  });

  it('shows breakeven as $0.00 without a sign', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[2]!);
    expect(c[4]).toBe('$0.00');
    expect(c[4]).not.toMatch(/[+−-]/);
  });

  it('shows an open trade with an Open badge and dashes', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[3]!);
    expect(c.slice(4)).toEqual(['—', '—', 'OpenClose']);
    expect(within(rows[3]!).getByText('Open')).toBeTruthy();
  });

  it('shows R as a dash for a closed trade without a stop', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[4]!);
    expect(c[4]).toBe('+$10.00');
    expect(c[5]).toBe('—');
    expect(c[6]).toBe('Closed');
  });

  it('shows a future with its quantity and symbol', async () => {
    const { rows } = await setup();
    const c = cellsOf(rows[5]!);
    expect(c[1]).toBe('MES');
    expect(c[3]).toBe('2');
  });

  it('shows a short as ▼ Short', async () => {
    const { rows } = await setup();
    expect(cellsOf(rows[6]!)[2]).toBe('▼ Short');
  });

  it('puts the UTC openedAt in <time dateTime>', async () => {
    const { rows } = await setup();
    const time = rows[0]!.querySelector('time')!;
    expect(time.getAttribute('datetime')).toBe('2026-11-19T14:41:00.000Z');
  });

  it('shows the year when the trade is not in the current year', async () => {
    const { fetchFn } = stubFetch(() =>
      json({
        items: [
          trade({ openedAt: '2025-03-05T15:30:00.000Z', net: '1' }),
          trade({ openedAt: '2026-03-05T15:30:00.000Z', net: '1' }),
        ],
      }),
    );
    renderPage(fetchFn);
    await screen.findByRole('table');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const [old, current] = bodyRows().map((r) => cellsOf(r)[0]!);
    expect(old).toContain('2025');
    expect(old).toContain('Mar');
    expect(current).not.toContain('2026');
    expect(current).toContain('Mar');
  });

  it('has a caption and scope="col" headers', async () => {
    await setup();
    const table = screen.getByRole('table', {
      name: 'Your trades, newest first. Choose a symbol to edit.',
    });
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((h) => h.textContent)).toEqual([
      'Opened',
      'Symbol',
      'Side',
      'Qty',
      'Net P&L',
      'R',
      'Status',
    ]);
    for (const h of heads) expect(h.getAttribute('scope')).toBe('col');
  });

  it('renders the phone card list in the same order with the same figures', async () => {
    await setup();
    const list = screen.getByRole('list', { name: 'Your trades' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(7);
    expect(cards[0]!.textContent).toContain('AAPL');
    expect(cards[0]!.textContent).toContain('+$98.76');
    expect(cards[3]!.textContent).toContain('Open');
    expect(cards[3]!.textContent).toContain('—');
  });
});

describe('Load more', () => {
  const page1 = () =>
    Array.from({ length: 25 }, (_, i) => trade({ symbol: `A${i}`, net: '1' }));

  it('appends the next page using the cursor', async () => {
    const second = [trade({ symbol: 'NEXT1', net: '2' })];
    const { fetchFn, gets } = stubFetch((url) =>
      url.searchParams.get('cursor') === 'c1'
        ? json({ items: second })
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    expect(cellsOf(bodyRows()[25]!)[1]).toBe('NEXT1');
    expect(cellsOf(bodyRows()[0]!)[1]).toBe('A0');
    const last = gets()[1]!.url;
    expect(last.searchParams.get('cursor')).toBe('c1');
    expect(last.searchParams.get('limit')).toBe('25');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows Loading… with aria-busy while the page is in flight', async () => {
    const d = deferred<Response>();
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.has('cursor')
        ? d.promise
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const busy = await screen.findByRole('button', { name: 'Loading…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      d.resolve(json({ items: [] }));
    });
  });

  it('is hidden when there is no nextCursor', async () => {
    const { fetchFn } = stubFetch(() => json({ items: page1() }));
    renderPage(fetchFn);
    await screen.findByRole('table');
    await waitFor(() => expect(bodyRows()).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('is hidden after a page comes back empty with a cursor', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.has('cursor')
        ? json({ items: [], nextCursor: 'c2' })
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Load more|Loading/ }),
      ).toBeNull(),
    );
    expect(bodyRows()).toHaveLength(25);
  });

  it('keeps focus on the button while it stays', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.get('cursor') === 'c1'
        ? json({ items: [trade({ symbol: 'N1' })], nextCursor: 'c2' })
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    const button = await screen.findByRole('button', { name: 'Load more' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    const after = screen.getByRole('button', { name: 'Load more' });
    await waitFor(() => expect(document.activeElement).toBe(after));
  });

  it('moves focus to the first new row when the button disappears', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.get('cursor') === 'c1'
        ? json({ items: [trade({ symbol: 'N1' }), trade({ symbol: 'N2' })] })
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    const button = await screen.findByRole('button', { name: 'Load more' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(bodyRows()).toHaveLength(27));
    await waitFor(() => expect(document.activeElement).toBe(bodyRows()[25]));
  });

  it('keeps rows on failure, shows the alert, and Retry refetches the same cursor', async () => {
    let fail = true;
    const { fetchFn, gets } = stubFetch((url) => {
      if (url.searchParams.get('cursor') === 'c1') {
        return fail
          ? json({ message: 'x' }, 500)
          : json({ items: [trade({ symbol: 'N1' })] });
      }
      return json({ items: page1(), nextCursor: 'c1' });
    });
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t load more trades');
    expect(bodyRows()).toHaveLength(25);
    const retry = within(alert).getByRole('button', { name: 'Retry' });
    await waitFor(() => expect(document.activeElement).toBe(retry));
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    const cursors = gets().map((c) => c.url.searchParams.get('cursor'));
    expect(cursors).toEqual([null, 'c1', 'c1']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Sign in under the rows on a 401', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.has('cursor')
        ? json({}, 401)
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    const { onSignIn } = renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Your session has expired. Sign in again.',
    );
    expect(bodyRows()).toHaveLength(25);
    fireEvent.click(within(alert).getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

describe('states', () => {
  it('shows the header and Loading… status with no rows while loading', async () => {
    const d = deferred<Response>();
    const { fetchFn } = stubFetch(() => d.promise as unknown as Response);
    renderPage(fetchFn);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(bodyRows()).toHaveLength(0);
    await act(async () => {
      d.resolve(json({ items: [trade()] }));
    });
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the empty state and Log a trade calls onLogTrade', async () => {
    const { fetchFn } = stubFetch(() => json({ items: [] }));
    const { onLogTrade } = renderPage(fetchFn);
    await screen.findByText('No trades yet.');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Log a trade' }));
    expect(onLogTrade).toHaveBeenCalledOnce();
  });

  it('opens the dialog from the empty state in the app', async () => {
    const { fetchFn } = stubFetch(() => json({ items: [] }));
    render(<AuthView config={config} fetchFn={fetchFn} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log a trade' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the session alert on a 401 and Sign in calls signinRedirect', async () => {
    const { fetchFn } = stubFetch(() => json({}, 401));
    render(<AuthView config={config} fetchFn={fetchFn} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Your session has expired. Sign in again.',
    );
    fireEvent.click(within(alert).getByRole('button', { name: 'Sign in' }));
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it('shows an error with Retry on a first-load failure, and Retry refetches', async () => {
    let fail = true;
    const { fetchFn, gets } = stubFetch(() =>
      fail ? json({}, 500) : json({ items: [trade({ symbol: 'OK' })] }),
    );
    renderPage(fetchFn);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Couldn’t load your trades. Check your connection and try again.',
    );
    expect(bodyRows()).toHaveLength(0);
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(gets()).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the session alert when there is no access token', async () => {
    const { fetchFn, calls } = stubFetch(() => json({ items: [] }));
    renderPage(fetchFn, { accessToken: undefined });
    await screen.findByRole('alert');
    expect(calls).toHaveLength(0);
  });
});

describe('stale responses', () => {
  it('aborts the request when navigating away mid-load, and nothing lands', async () => {
    const d = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const { fetchFn } = stubFetch((url, init) => {
      if (!url.searchParams.has('from')) {
        signal = init?.signal;
        return d.promise as unknown as Response;
      }
      return json({ items: [] });
    });
    render(<AuthView config={config} fetchFn={fetchFn} />);
    await waitFor(() => expect(signal).toBeTruthy());
    fireEvent.click(screen.getByRole('link', { name: 'Calendar' }));
    expect(signal!.aborted).toBe(true);
    await screen.findByRole('heading', { level: 1, name: /20\d\d/ });
    await act(async () => {
      d.resolve(json({ items: [trade({ symbol: 'LATE' })] }));
    });
    expect(screen.queryByText('LATE')).toBeNull();
    expect(screen.queryByRole('table', { name: /newest first/ })).toBeNull();
  });
});

describe('saving from the Trades page', () => {
  async function fillAndSave() {
    fireEvent.click(screen.getByRole('button', { name: 'New trade' }));
    fireEvent.change(screen.getByLabelText('Symbol'), {
      target: { value: 'AAPL' },
    });
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Entry'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
  }

  it('closes the dialog, toasts, and reloads page 1 dropping Load more rows, keeping old rows until it resolves', async () => {
    const first = [trade({ symbol: 'ONE', net: '1' })];
    const more = [trade({ symbol: 'TWO', net: '1' })];
    const saved = trade({ symbol: 'AAPL' });
    let didSave = false;
    const reload = deferred<Response>();
    const { fetchFn, gets } = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        didSave = true;
        return json(saved, 201);
      }
      if (url.searchParams.get('cursor') === 'c1') return json({ items: more });
      if (didSave) return reload.promise as unknown as Response;
      return json({ items: first, nextCursor: 'c1' });
    });
    render(<AuthView config={config} fetchFn={fetchFn} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));

    await fillAndSave();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();

    // The reload is in flight: old rows stay.
    await waitFor(() => expect(gets()).toHaveLength(3));
    const reloadCall = gets()[2]!.url;
    expect(reloadCall.searchParams.get('limit')).toBe('25');
    expect(reloadCall.searchParams.has('cursor')).toBe(false);
    expect(bodyRows()).toHaveLength(2);

    await act(async () => {
      reload.resolve(json({ items: [saved, ...first] }));
    });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(bodyRows().map((r) => cellsOf(r)[1])).toEqual(['AAPL', 'ONE']);
    expect(screen.queryByText('TWO')).toBeNull();
  });

  it('moves focus to the <h1> when saving from the empty state', async () => {
    const saved = trade({ symbol: 'AAPL' });
    let didSave = false;
    const { fetchFn } = stubFetch((_url, init) => {
      if (init?.method === 'POST') {
        didSave = true;
        return json(saved, 201);
      }
      return json({ items: didSave ? [saved] : [] });
    });
    render(<AuthView config={config} fetchFn={fetchFn} />);
    const opener = await screen.findByRole('button', { name: 'Log a trade' });
    fireEvent.click(opener);
    await fillAndSave2();
    await waitFor(() => expect(opener.isConnected).toBe(false));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Trades' }),
      ),
    );
  });
});

async function fillAndSave2() {
  fireEvent.change(screen.getByLabelText('Symbol'), {
    target: { value: 'AAPL' },
  });
  fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
  await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
}

describe('refresh, token renewal and focus (review fixes)', () => {
  const page1 = () =>
    Array.from({ length: 25 }, (_, i) => trade({ symbol: `A${i}`, net: '1' }));

  it('ignores Load more while a refresh is in flight, so the refreshed page survives', async () => {
    const first = [trade({ symbol: 'ONE', net: '1' })];
    const saved = trade({ symbol: 'NEWEST' });
    let didSave = false;
    const reload = deferred<Response>();
    const { fetchFn, gets } = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        didSave = true;
        return json(saved, 201);
      }
      if (url.searchParams.has('cursor')) {
        return json({ items: [trade({ symbol: 'STALE' })] });
      }
      if (didSave) return reload.promise as unknown as Response;
      return json({ items: first, nextCursor: 'c1' });
    });
    render(<AuthView config={config} fetchFn={fetchFn} />);
    await screen.findByRole('button', { name: 'Load more' });
    await fillAndSaveDialog();
    await waitFor(() => expect(gets()).toHaveLength(2));

    const button = screen.getByRole('button', { name: 'Load more' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(gets()).toHaveLength(2);

    await act(async () => {
      reload.resolve(json({ items: [saved, ...first] }));
    });
    await waitFor(() =>
      expect(bodyRows().map((r) => cellsOf(r)[1])).toEqual(['NEWEST', 'ONE']),
    );
    expect(screen.queryByText('STALE')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('keeps the rows and makes no request when the access token renews', async () => {
    const { fetchFn, gets } = stubFetch((url) =>
      url.searchParams.has('cursor')
        ? json({ items: [trade({ symbol: 'N1' })], nextCursor: 'c2' })
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    const props = {
      apiUrl: config.apiUrl,
      onSignIn: vi.fn(),
      onLogTrade: vi.fn(),
      onOpenTrade: vi.fn(),
      fetchFn,
    };
    const { rerender } = render(<TradesPage {...props} accessToken="tok" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    rerender(<TradesPage {...props} accessToken="renewed" />);
    await act(async () => {});
    expect(gets()).toHaveLength(2);
    expect(bodyRows()).toHaveLength(26);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(gets()).toHaveLength(3));
    expect(
      (gets()[2]!.init?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer renewed');
  });

  it('moves focus to Load more when Retry starts loading', async () => {
    const retry = deferred<Response>();
    let fail = true;
    const { fetchFn } = stubFetch((url) => {
      if (url.searchParams.has('cursor')) {
        return fail ? json({}, 500) : (retry.promise as unknown as Response);
      }
      return json({ items: page1(), nextCursor: 'c1' });
    });
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const alert = await screen.findByRole('alert');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    const button = await screen.findByRole('button', { name: 'Loading…' });
    await waitFor(() => expect(document.activeElement).toBe(button));
    await act(async () => {
      retry.resolve(json({ items: [trade({ symbol: 'N1' })] }));
    });
  });

  it('focuses Sign in when Load more gets a 401', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.searchParams.has('cursor')
        ? json({}, 401)
        : json({ items: page1(), nextCursor: 'c1' }),
    );
    renderPage(fetchFn);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(alert).getByRole('button', { name: 'Sign in' }),
      ),
    );
  });
});

describe('Back or Forward while the dialog is open', () => {
  it('keeps the dialog and typed trade, then focuses the new page h1 on close', async () => {
    const saved = trade({ symbol: 'AAPL' });
    const { fetchFn } = stubFetch((_url, init) =>
      init?.method === 'POST' ? json(saved, 201) : json({ items: [] }),
    );
    render(<AuthView config={config} fetchFn={fetchFn} />);
    const opener = await screen.findByRole('button', { name: 'Log a trade' });
    fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('Symbol'), {
      target: { value: 'AAPL' },
    });
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Entry'), {
      target: { value: '5' },
    });

    window.history.pushState(null, '', '/');
    await act(async () => {
      fireEvent(window, new PopStateEvent('popstate'));
    });
    await screen.findByRole('heading', { level: 1, name: /2026/ });
    expect(opener.isConnected).toBe(false);
    const symbol = screen.getByLabelText('Symbol') as HTMLInputElement;
    expect(symbol.value).toBe('AAPL');
    expect(document.activeElement).not.toBe(document.querySelector('main h1'));

    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('main h1')),
    );
  });
});

async function fillAndSaveDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'New trade' }));
  fireEvent.change(screen.getByLabelText('Symbol'), {
    target: { value: 'AAPL' },
  });
  fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
  await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
}
