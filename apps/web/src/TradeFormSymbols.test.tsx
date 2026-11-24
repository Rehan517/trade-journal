import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogHarness } from './DialogHarness.tsx';
import type { StorageLike } from './lastTrade.ts';

const apiUrl = 'https://api.example.com';
const now = () => new Date(2026, 10, 19, 9, 30, 15);

const storage = (): StorageLike => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

const view = (over: Record<string, unknown> = {}) => ({
  id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
  symbol: 'MESZ6',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  openedAt: '2026-11-19T14:30:00.000Z',
  fees: '0',
  createdAt: '2026-11-19T14:31:00.000Z',
  updatedAt: '2026-11-19T14:31:00.000Z',
  metrics: {},
  ...over,
});

type Call = { method: string; path: string; body: unknown };

/** Answers the trade write with `trade`, and a symbol PUT with `put`. */
function stub(trade: unknown, put: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    if (call.path.startsWith('/symbols')) return Promise.resolve(put());
    return Promise.resolve(
      new Response(JSON.stringify(trade), {
        status: call.method === 'POST' ? 201 : 200,
      }),
    );
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    calls,
    puts: () => calls.filter((c) => c.path !== '/trades'),
  };
}

const setting = (root: string, pointValue: string) =>
  new Response(
    JSON.stringify({ root, pointValue, updatedAt: '2026-11-19T14:32:00.000Z' }),
    { status: 200 },
  );

function setup({
  saved = {},
  trade = view(),
  put = () => setting('MES', '5'),
  onSymbolSaved,
}: {
  saved?: Record<string, string>;
  trade?: unknown;
  put?: () => Response | Promise<Response>;
  onSymbolSaved?: (s: unknown) => void;
} = {}) {
  const api = stub(trade, put);
  render(
    <DialogHarness
      apiUrl={apiUrl}
      accessToken="tok"
      onSignIn={() => {}}
      fetchFn={api.fetchFn}
      now={now}
      storage={storage()}
      symbols={new Map(Object.entries(saved))}
      onSymbolSaved={onSymbolSaved}
    />,
  );
  return api;
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const click = (name: string) =>
  fireEvent.click(screen.getByRole('radio', { name }));
const hint = (text: string) => screen.getByText(text);
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));

function fillFuture(symbol: string, pointValue?: string) {
  click('Future');
  type('Symbol', symbol);
  if (pointValue !== undefined) type('Point value', pointValue);
  type('Qty', '2');
  type('Entry', '5000');
}

afterEach(cleanup);

describe('point value fill', () => {
  it('fills a default for the root and says so', () => {
    setup();
    click('Future');
    type('Symbol', 'NQ');
    expect(field('Point value').value).toBe('20');
    expect(hint('CME default for NQ.')).toBeTruthy();
  });

  it('fills from a saved value ahead of the default', () => {
    setup({ saved: { NQ: '25' } });
    click('Future');
    type('Symbol', 'NQ');
    expect(field('Point value').value).toBe('25');
    expect(hint('Saved for NQ.')).toBeTruthy();
  });

  it('keeps the fill as MESZ6 is typed, one character at a time', () => {
    setup();
    click('Future');
    for (const text of ['M', 'ME', 'MES', 'MESZ', 'MESZ6']) {
      type('Symbol', text);
    }
    expect(field('Point value').value).toBe('5');
    expect(hint('CME default for MES.')).toBeTruthy();
  });

  it('refills when the root changes and the value is still the fill', () => {
    setup();
    click('Future');
    type('Symbol', 'NQ');
    type('Symbol', 'ES');
    expect(field('Point value').value).toBe('50');
    expect(hint('CME default for ES.')).toBeTruthy();
  });

  it('never overwrites a typed value', () => {
    setup();
    click('Future');
    type('Symbol', 'NQ');
    type('Point value', '21');
    type('Symbol', 'ES');
    expect(field('Point value').value).toBe('21');
    expect(hint('Saving remembers this for ES.')).toBeTruthy();
  });

  it('never overwrites a value typed before the symbol', () => {
    setup();
    click('Future');
    type('Point value', '7');
    type('Symbol', 'MES');
    expect(field('Point value').value).toBe('7');
  });

  it('clears a filled value when the symbol is cleared or has no known value', () => {
    setup();
    click('Future');
    type('Symbol', 'NQ');
    type('Symbol', '');
    expect(field('Point value').value).toBe('');
    type('Symbol', 'ES');
    type('Symbol', 'ZZZ');
    expect(field('Point value').value).toBe('');
    expect(hint('New symbol. This value is remembered for ZZZ.')).toBeTruthy();
  });

  it('fills nothing for a stock, and shows no hint', () => {
    setup();
    type('Symbol', 'ES');
    expect(screen.queryByLabelText('Point value')).toBeNull();
    expect(screen.queryByText(/CME default/)).toBeNull();
    expect(screen.queryByText(/New symbol/)).toBeNull();
    // Type stays Stock: a known root never switches it.
    expect(
      (screen.getByRole('radio', { name: 'Stock' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('fills when Type becomes Future after the symbol was typed', () => {
    setup();
    type('Symbol', 'ES');
    click('Future');
    expect(field('Point value').value).toBe('50');
    expect(hint('CME default for ES.')).toBeTruthy();
  });

  it('shows the changed-value hints', () => {
    setup({ saved: { MES: '5' } });
    click('Future');
    type('Symbol', 'MES');
    expect(hint('Saved for MES.')).toBeTruthy();
    type('Point value', '6');
    expect(hint('Saving replaces $5 for MES.')).toBeTruthy();
    // The same number written differently is the same value.
    type('Point value', '5.00');
    expect(hint('Saved for MES.')).toBeTruthy();
  });

  it('formats a fractional saved value in the hint', () => {
    setup({ saved: { MYM: '0.5' } });
    click('Future');
    type('Symbol', 'MYM');
    type('Point value', '1');
    expect(hint('Saving replaces $0.50 for MYM.')).toBeTruthy();
  });

  it('shows no hint for a symbol that is not a root the settings can hold', () => {
    setup();
    click('Future');
    type('Symbol', 'BRK.B');
    expect(screen.queryByText(/remembered for/)).toBeNull();
  });

  it('links the hint, and an error too, with aria-describedby', () => {
    setup();
    click('Future');
    type('Symbol', 'ZZZ');
    const input = field('Point value');
    const hintEl = screen.getByText(
      'New symbol. This value is remembered for ZZZ.',
    );
    expect(input.getAttribute('aria-describedby')).toBe(hintEl.id);

    type('Qty', '2');
    type('Entry', '5000');
    save();
    const error = screen.getByText('Enter dollars per point, like 5.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(
      `${error.id} ${hintEl.id}`,
    );
  });

  it('keeps room for the hint line even when there is no hint', () => {
    setup();
    click('Future');
    expect(
      field('Point value').closest('.cell')!.querySelector('.cell__foot'),
    ).not.toBeNull();
  });
});

describe('saved values that load after the form opened', () => {
  const harness = (
    api: ReturnType<typeof stub>,
    saved: Record<string, string>,
  ) => (
    <DialogHarness
      apiUrl={apiUrl}
      accessToken="tok"
      onSignIn={() => {}}
      fetchFn={api.fetchFn}
      now={now}
      storage={storage()}
      symbols={new Map(Object.entries(saved))}
    />
  );

  it('replaces a filled default with the saved value, and saves no PUT', async () => {
    const api = stub(view({ pointValue: '6' }), () => setting('MES', '6'));
    const { rerender } = render(harness(api, {}));
    fillFuture('MESZ6');
    expect(field('Point value').value).toBe('5');
    rerender(harness(api, { MES: '6' }));
    expect(field('Point value').value).toBe('6');
    expect(hint('Saved for MES.')).toBeTruthy();
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(api.calls.map((c) => c.method)).toEqual(['POST']);
    expect(api.calls[0]!.body).toMatchObject({ pointValue: '6' });
  });

  it('leaves a typed value alone', () => {
    const api = stub(view(), () => setting('MES', '6'));
    const { rerender } = render(harness(api, {}));
    fillFuture('MESZ6', '7');
    rerender(harness(api, { MES: '6' }));
    expect(field('Point value').value).toBe('7');
  });
});

describe('saving a point value', () => {
  it('saves a new symbol, after the trade, and tells the shell', async () => {
    const onSymbolSaved = vi.fn();
    const { puts } = setup({
      onSymbolSaved,
      trade: view({ symbol: 'ZNH7', pointValue: '1000' }),
      put: () => setting('ZN', '1000'),
    });
    fillFuture('ZNH7', '1000');
    save();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      method: 'PUT',
      path: '/symbols/ZN',
      body: { pointValue: '1000' },
    });
    expect(screen.getByText('Trade saved')).toBeTruthy();
    await waitFor(() =>
      expect(onSymbolSaved).toHaveBeenCalledWith({
        root: 'ZN',
        pointValue: '1000',
        updatedAt: '2026-11-19T14:32:00.000Z',
      }),
    );
  });

  it('does not save a value equal to the default', async () => {
    const { calls } = setup();
    fillFuture('MESZ6');
    expect(field('Point value')).toHaveProperty('value', '5');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('saves a changed default', async () => {
    const { puts } = setup({
      trade: view({ symbol: 'NQ', pointValue: '21' }),
      put: () => setting('NQ', '21'),
    });
    fillFuture('NQ', '21');
    save();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({
      path: '/symbols/NQ',
      body: { pointValue: '21' },
    });
  });

  it('saves a value that differs from the saved one', async () => {
    const { puts } = setup({
      saved: { MES: '5' },
      trade: view({ pointValue: '6' }),
    });
    fillFuture('MES', '6');
    save();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({ body: { pointValue: '6' } });
  });

  it('does not save 5.00 against a saved 5', async () => {
    const { calls } = setup({
      saved: { MES: '5' },
      trade: view({ pointValue: '5.00' }),
    });
    fillFuture('MES', '5.00');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('does not save for a stock, or a root settings cannot hold', async () => {
    const stock = setup({
      trade: view({
        symbol: 'AAPL',
        instrumentType: 'stock',
        pointValue: undefined,
      }),
    });
    type('Symbol', 'AAPL');
    type('Qty', '2');
    type('Entry', '190');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(stock.calls).toHaveLength(1);
    cleanup();

    const odd = setup({ trade: view({ symbol: 'BRK.B' }) });
    fillFuture('BRK.B', '5');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(odd.calls).toHaveLength(1);
  });

  it('shows nothing when the PUT fails, and the trade is still saved', async () => {
    const onSymbolSaved = vi.fn();
    const { puts } = setup({
      trade: view({ symbol: 'ZNH7', pointValue: '1000' }),
      put: () => new Response('{}', { status: 500 }),
      onSymbolSaved,
    });
    fillFuture('ZNH7', '1000');
    save();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(screen.getByText('Trade saved')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSymbolSaved).not.toHaveBeenCalled();
  });
});

describe('Edit and Close', () => {
  it('never fill the point value or save it', async () => {
    const trade = view({ symbol: 'NQ', pointValue: '30' });
    const api = stub(trade, () => setting('NQ', '30'));
    render(
      <DialogHarness
        apiUrl={apiUrl}
        accessToken="tok"
        onSignIn={() => {}}
        fetchFn={api.fetchFn}
        now={now}
        storage={storage()}
        mode="edit"
        trade={trade as never}
      />,
    );
    expect(field('Point value').value).toBe('30');
    expect(screen.queryByText(/CME default|Saved for|New symbol/)).toBeNull();
    // Changing the symbol doesn't refill the point value.
    type('Symbol', 'ES');
    expect(field('Point value').value).toBe('30');
    type('Point value', '31');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    expect(api.calls.map((c) => c.method)).toEqual(['PATCH']);
  });
});
