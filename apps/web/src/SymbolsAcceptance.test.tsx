import {
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

// Spec #10, "Automated tests (#10)" > Web > Acceptance 1 and 2, and "Edit and
// Close never send a PUT", driven through the signed-in shell with a small
// in-memory API.

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
const NOW = new Date('2026-11-23T15:00:00.000Z');

const MES_TRADE = {
  id: '00000000-0000-4000-8000-000000000002',
  symbol: 'MES',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  exitPrice: '5010',
  fees: '0',
  openedAt: '2026-11-19T15:30:00.000Z',
  closedAt: '2026-11-19T16:30:00.000Z',
  createdAt: '2026-11-19T15:31:00.000Z',
  updatedAt: '2026-11-19T15:31:00.000Z',
  metrics: { netPnl: '100', rMultiple: undefined },
};
const OPEN_MES = {
  ...MES_TRADE,
  id: '00000000-0000-4000-8000-000000000003',
  exitPrice: undefined,
  closedAt: undefined,
  metrics: {},
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

type Call = { method: string; path: string; body: unknown };

function setup(initialTrades: Record<string, unknown>[] = []) {
  const trades = [...initialTrades];
  const saved = new Map<string, string>();
  const calls: Call[] = [];
  let seq = 10;
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const root = call.path.split('/')[2] ?? '';
    if (call.path === '/symbols') {
      return Promise.resolve(
        json({
          items: [...saved].map(([r, pointValue]) => ({
            root: r,
            pointValue,
            updatedAt: '2026-11-19T14:31:00.000Z',
          })),
        }),
      );
    }
    if (call.path.startsWith('/symbols/')) {
      if (call.method === 'PUT') {
        const pointValue = (call.body as { pointValue: string }).pointValue;
        saved.set(root, pointValue);
        return Promise.resolve(
          json({ root, pointValue, updatedAt: '2026-11-19T14:32:00.000Z' }),
        );
      }
      saved.delete(root);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (call.method === 'POST') {
      const trade = {
        ...(call.body as object),
        id: `00000000-0000-4000-8000-0000000000${seq++}`,
        createdAt: '2026-11-23T15:00:00.000Z',
        updatedAt: '2026-11-23T15:00:00.000Z',
        metrics: {},
      };
      trades.push(trade);
      return Promise.resolve(json(trade, 201));
    }
    if (call.method === 'PATCH') {
      const id = call.path.split('/')[2];
      const at = trades.findIndex((t) => t.id === id);
      trades[at] = { ...trades[at], ...(call.body as object) };
      return Promise.resolve(json(trades[at]));
    }
    return Promise.resolve(json({ items: trades }));
  }) as unknown as typeof fetch;
  render(<AuthView config={config} fetchFn={fetchFn} />);
  const symbolWrites = () =>
    calls.filter((c) => c.path.startsWith('/symbols/'));
  return { calls, symbolWrites, saved };
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const clickRadio = (name: string) =>
  fireEvent.click(screen.getByRole('radio', { name }));
const openNewTrade = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'New trade' }));
  await screen.findByRole('dialog');
};
const saveTrade = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
const savedToast = () =>
  waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
const dialogGone = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
const saveWithKeys = () =>
  fireEvent.keyDown(screen.getByLabelText('Notes'), {
    key: 'Enter',
    ctrlKey: true,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/trades');
  window.localStorage.clear();
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    signinRedirect: vi.fn(),
    removeUser: vi.fn(),
    user: { access_token: 'tok', profile: { email: 'me@example.com' } },
  } as unknown as ReturnType<typeof useAuth>);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Acceptance 1: type a point value once', () => {
  it('fills the MES default with no PUT, saves ZN 1000 once, then fills ZNM7 from it', async () => {
    const { symbolWrites } = setup();

    // A new user: MESZ6 fills the default, and saving it sends no PUT.
    await openNewTrade();
    clickRadio('Future');
    type('Symbol', 'MESZ6');
    expect(field('Point value').value).toBe('5');
    expect(screen.getByText('CME default for MES.')).toBeTruthy();
    type('Qty', '1');
    type('Entry', '5000');
    saveTrade();
    await savedToast();
    await dialogGone();
    expect(symbolWrites()).toEqual([]);

    // A symbol with no default: type 1000, save, one PUT for the root.
    await openNewTrade();
    clickRadio('Future');
    type('Symbol', 'ZNH7');
    expect(field('Point value').value).toBe('');
    type('Point value', '1000');
    type('Qty', '1');
    type('Entry', '110');
    saveTrade();
    await dialogGone();
    await waitFor(() => expect(symbolWrites()).toHaveLength(1));
    expect(symbolWrites()[0]).toEqual({
      method: 'PUT',
      path: '/symbols/ZN',
      body: { pointValue: '1000' },
    });

    // The next ZN contract is filled from the saved value, and saving it
    // sends no further PUT.
    await openNewTrade();
    clickRadio('Future');
    type('Symbol', 'ZNM7');
    expect(field('Point value').value).toBe('1000');
    expect(screen.getByText('Saved for ZN.')).toBeTruthy();
    type('Qty', '1');
    type('Entry', '111');
    saveTrade();
    await dialogGone();
    await waitFor(() =>
      expect(screen.getAllByText('Trade saved').length).toBeGreaterThan(0),
    );
    expect(symbolWrites()).toHaveLength(1);
  });
});

describe('Acceptance 2: changing a saved value leaves logged trades alone', () => {
  it('after MES is set to 6 on Settings, an MES trade in Edit still shows 5 and its P&L is unchanged', async () => {
    // P&L comes from the server's metrics, so the row text alone can't
    // change here. The meaningful checks are that nothing rewrites the
    // trade (no PATCH or POST) and that Edit still shows its own 5.
    const { calls } = setup([MES_TRADE]);
    const editName = /^Edit MES long trade/;
    const row = async () =>
      (
        await within(screen.getByRole('table')).findByRole('button', {
          name: editName,
        })
      ).closest('tr')!;
    const before = (await row()).textContent;
    expect(before).toContain('100');

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit MES' }));
    fireEvent.change(screen.getByLabelText('Point value for MES'), {
      target: { value: '6' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByText('Point value saved')).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('link', { name: 'Trades' }));
    expect((await row()).textContent).toBe(before);
    fireEvent.click(
      await within(screen.getByRole('table')).findByRole('button', {
        name: editName,
      }),
    );
    expect(field('Point value').value).toBe('5');
    expect(screen.queryByText(/Saved for MES|CME default/)).toBeNull();
    expect(
      calls.filter((c) => c.path.startsWith('/trades') && c.method !== 'GET'),
    ).toEqual([]);
  });
});

describe('Edit and Close never send a symbol request', () => {
  it('Edit of an MES trade with a changed point value sends only a PATCH', async () => {
    const { calls, symbolWrites } = setup([MES_TRADE]);
    fireEvent.click(
      await within(screen.getByRole('table')).findByRole('button', {
        name: /^Edit MES long trade/,
      }),
    );
    type('Point value', '7');
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(symbolWrites()).toEqual([]);
  });

  it('Close of an open MES trade sends only a PATCH', async () => {
    const { calls, symbolWrites } = setup([OPEN_MES]);
    fireEvent.click(
      await within(screen.getByRole('table')).findByRole('button', {
        name: /^Close MES long trade/,
      }),
    );
    expect(field('Point value').value).toBe('5');
    type('Exit', '5010');
    saveWithKeys();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(symbolWrites()).toEqual([]);
  });
});
