import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogHarness } from './DialogHarness.tsx';
import { LAST_TRADE_KEY, type StorageLike } from './lastTrade.ts';

const apiUrl = 'https://api.example.com';
// 09:30 in the test zone (America/New_York, see the test script).
const now = () => new Date(2026, 10, 19, 9, 30, 15);

function memoryStorage(initial?: string): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(LAST_TRADE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const view = (over: Record<string, unknown> = {}) => ({
  id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
  symbol: 'MES',
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

const respond = (body: unknown, status: number) =>
  vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch;

function setup<S extends StorageLike = ReturnType<typeof memoryStorage>>(
  fetchFn: typeof fetch = respond(view(), 201),
  storage: StorageLike | S = memoryStorage(),
  accessToken: string | undefined = 'tok',
) {
  const onSignIn = vi.fn();
  render(
    <DialogHarness
      apiUrl={apiUrl}
      accessToken={accessToken}
      onSignIn={onSignIn}
      fetchFn={fetchFn}
      now={now}
      storage={storage}
    />,
  );
  return { fetchFn, storage: storage as S, onSignIn };
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const click = (name: string) =>
  fireEvent.click(screen.getByRole('radio', { name }));
const checked = (name: string) =>
  (screen.getByRole('radio', { name }) as HTMLInputElement).checked;
// Testing Library folds U+202F into a plain space when matching text, so a
// function matcher checks the exact characters.
const exact = (text: string) =>
  screen.getByText((_, el) => el?.textContent === text && !el.children.length);
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
// A save closes the dialog and the form goes with it; the next open is fresh.
const reopen = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Open trade dialog' }));

function fillExampleA() {
  click('Future');
  type('Symbol', 'mes');
  type('Point value', '5');
  type('Qty', '2');
  type('Entry', '5000');
  type('Fees', '1.24');
  type('Stop', '4995');
  type('Exit', '5010');
  type('Exit time', '2026-11-19T09:45');
}

afterEach(cleanup);

describe('TradeForm saving', () => {
  it('posts example A with UTC times, then opens blank, keeping type, side and point value', async () => {
    const { fetchFn, storage } = setup();
    fillExampleA();
    expect(screen.getByText('+$98.76')).toBeTruthy();
    expect(exact('+1.98\u202fR')).toBeTruthy();
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(`${apiUrl}/trades`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      instrumentType: 'future',
      side: 'long',
      symbol: 'mes',
      pointValue: '5',
      quantity: '2',
      entryPrice: '5000',
      exitPrice: '5010',
      fees: '1.24',
      plannedStop: '4995',
      openedAt: '2026-11-19T14:30:00.000Z',
      closedAt: '2026-11-19T14:45:00.000Z',
    });
    // The dialog closed on the 201; the next open starts from the defaults.
    expect(screen.queryByLabelText('Symbol')).toBeNull();
    reopen();
    expect(field('Symbol').value).toBe('');
    expect(field('Point value').value).toBe('5');
    expect(field('Entry time').value).toBe('2026-11-19T09:30');
    expect(checked('Future')).toBe(true);
    expect(document.activeElement).toBe(field('Symbol'));
    expect(JSON.parse(storage.data.get(LAST_TRADE_KEY)!)).toEqual({
      instrumentType: 'future',
      side: 'long',
      pointValue: '5',
    });
  });

  it('shows an open trade: "Open" in the header, risk only in the strip', () => {
    setup();
    click('Future');
    type('Point value', '5');
    type('Qty', '2');
    type('Entry', '5000');
    type('Stop', '4995');
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    // Net P&L, R and Planned R:R.
    expect(screen.getAllByText('–')).toHaveLength(3);
  });

  it('shows a loss with the true minus sign and returns to dashes when exit is cleared', () => {
    setup();
    click('Future');
    click('Short');
    type('Point value', '2');
    type('Qty', '1');
    type('Entry', '18000.25');
    type('Fees', '0.62');
    type('Stop', '18010.25');
    type('Exit', '18010.75');
    expect(screen.getByText('−$21.62')).toBeTruthy();
    expect(exact('\u22121.08\u202fR')).toBeTruthy();
    type('Exit', '');
    expect(screen.queryByText('−$21.62')).toBeNull();
  });

  it('typing an exit price fills a blank exit time but keeps one already set', () => {
    setup();
    type('Exit', '5');
    expect(field('Exit time').value).toBe('2026-11-19T09:30');
    type('Exit time', '2026-11-19T10:00');
    type('Exit', '');
    type('Exit', '6');
    expect(field('Exit time').value).toBe('2026-11-19T10:00');
  });

  it('keeps the point value when switching Type away and back', () => {
    setup();
    click('Future');
    type('Point value', '5');
    click('Stock');
    expect(screen.queryByLabelText('Point value')).toBeNull();
    click('Future');
    expect(field('Point value').value).toBe('5');
  });

  it('sends nothing, shows errors and focuses the first invalid field', () => {
    const { fetchFn } = setup();
    save();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a symbol, like MES or AAPL.')).toBeTruthy();
    expect(field('Symbol').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('Symbol'));
    const described = field('Symbol').getAttribute('aria-describedby')!;
    expect(document.getElementById(described)?.textContent).toContain(
      'Enter a symbol',
    );
  });

  it('shows errors on blur, not per keystroke, and clears them once fixed', () => {
    setup();
    type('Entry', 'abc');
    expect(screen.queryByText('Enter a price, like 5012.25.')).toBeNull();
    fireEvent.blur(field('Entry'));
    expect(screen.getByText('Enter a price, like 5012.25.')).toBeTruthy();
    type('Entry', '5000');
    expect(screen.queryByText('Enter a price, like 5012.25.')).toBeNull();
  });

  it.each([
    ['Long', '5001', 'Stop must be below entry for a long trade.'],
    ['Short', '4999', 'Stop must be above entry for a short trade.'],
  ])('rejects a %s stop on the wrong side', (side, stop, copy) => {
    const { fetchFn } = setup();
    click(side);
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5000');
    type('Stop', stop);
    save();
    expect(screen.getByText(copy)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('asks for the missing half of the exit pair', () => {
    setup();
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
    type('Exit time', '2026-11-19T10:00');
    save();
    expect(
      screen.getByText('Add an exit price, or clear the exit time.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(field('Exit'));
  });
});

describe('TradeForm failures', () => {
  const fillMinimum = () => {
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
  };

  it('puts a 400 fieldError on its cell and keeps the values', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: {
            plannedStop: ['plannedStop must be below entryPrice for a long'],
          },
          formErrors: ['Something at body level'],
        },
        400,
      ),
    );
    fillMinimum();
    save();
    await waitFor(() =>
      expect(
        screen.getByText('Stop must be below entry for a long trade.'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Something at body level',
    );
    expect(field('Symbol').value).toBe('AAPL');
    expect(document.activeElement).toBe(field('Stop'));
  });

  it('shows the session alert on 401 with a Sign in button', async () => {
    const { onSignIn } = setup(respond({ message: 'Unauthorized' }, 401));
    fillMinimum();
    save();
    await waitFor(() =>
      expect(
        screen.getByText('Your session has expired. Sign in again.'),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(field('Symbol').value).toBe('AAPL');
  });

  it('shows the retry alert on 500 and on a network failure', async () => {
    const copy =
      "Couldn't save the trade. Check your connection and try again.";
    const failing = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockRejectedValueOnce(
        new TypeError('Failed to fetch'),
      ) as unknown as typeof fetch;
    setup(failing);
    fillMinimum();
    save();
    await waitFor(() => expect(screen.getByText(copy)).toBeTruthy());
    save();
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(copy)).toBeTruthy());
    expect(field('Symbol').value).toBe('AAPL');
  });

  it('says the trade may have been saved when a 201 body is malformed', async () => {
    setup(respond({ nope: 1 }, 201));
    fillMinimum();
    save();
    await waitFor(() =>
      expect(screen.getByText(/may have been saved/)).toBeTruthy(),
    );
    expect(field('Symbol').value).toBe('AAPL');
  });

  it('disables Save while saving and ignores a second save', async () => {
    let resolve!: (r: Response) => void;
    const fetchFn = vi.fn(
      () => new Promise<Response>((r) => (resolve = r)),
    ) as unknown as typeof fetch;
    setup(fetchFn);
    fillMinimum();
    save();
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(field('Symbol'), { key: 'Enter', ctrlKey: true });
    fireEvent.click(button);
    expect(fetchFn).toHaveBeenCalledOnce();
    resolve(new Response(JSON.stringify(view()), { status: 201 }));
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
  });
});

describe('TradeForm defaults and keyboard', () => {
  it('defaults entry time to now, rounded down to the minute', () => {
    setup();
    expect(field('Entry time').value).toBe('2026-11-19T09:30');
  });

  it('reads type, side and point value from storage', () => {
    setup(
      undefined,
      memoryStorage(
        JSON.stringify({
          instrumentType: 'future',
          side: 'short',
          pointValue: '5',
        }),
      ),
    );
    expect(checked('Future')).toBe(true);
    expect(checked('Short')).toBe(true);
    expect(field('Point value').value).toBe('5');
  });

  it.each(['not json', '{"instrumentType":"bond","side":"long"}'])(
    'falls back to stock / long for %s',
    (raw) => {
      setup(undefined, memoryStorage(raw));
      expect(checked('Stock')).toBe(true);
      expect(checked('Long')).toBe(true);
    },
  );

  it('still works when storage throws', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    setup(undefined, throwing);
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
  });

  it('Enter moves to the next field and sends nothing; Enter in Notes is left alone', () => {
    const { fetchFn } = setup();
    const symbol = field('Symbol');
    symbol.focus();
    fireEvent.keyDown(symbol, { key: 'Enter' });
    expect(document.activeElement).toBe(field('Qty'));
    const target = field('Target');
    target.focus();
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(document.activeElement).toBe(field('Notes'));
    // true means nothing called preventDefault: the textarea adds its line.
    expect(fireEvent.keyDown(field('Notes'), { key: 'Enter' })).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('%s+Enter saves from Notes', async (_name, mods) => {
    const { fetchFn } = setup();
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
    fireEvent.keyDown(field('Notes'), { key: 'Enter', ...mods });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
  });

  it('keeps DOM order equal to reading order', () => {
    setup();
    click('Future');
    const order = [
      'Symbol',
      'Point value',
      'Qty',
      'Entry',
      'Exit',
      'Fees',
      'Entry time',
      'Exit time',
      'Stop',
      'Target',
      'Notes',
    ].map((l) => field(l));
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe('TradeForm review fixes', () => {
  const fillMinimum = () => {
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
  };

  it('clearing Exit takes back an exit time the form filled in', () => {
    setup();
    type('Exit', '5');
    expect(field('Exit time').value).toBe('2026-11-19T09:30');
    type('Exit', '');
    expect(field('Exit time').value).toBe('');
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('clearing Exit keeps an exit time the trader edited', () => {
    setup();
    type('Exit', '5');
    type('Exit time', '2026-11-19T09:45');
    type('Exit', '');
    expect(field('Exit time').value).toBe('2026-11-19T09:45');
  });

  it('clearing Exit keeps an exit time typed before the price', () => {
    setup();
    type('Exit time', '2026-11-19T09:45');
    type('Exit', '5');
    type('Exit', '');
    expect(field('Exit time').value).toBe('2026-11-19T09:45');
  });

  it('shows a 400 on a field with no cell (side) in the alert', async () => {
    setup(
      respond(
        { message: 'Invalid trade', fieldErrors: { side: ['Invalid option'] } },
        400,
      ),
    );
    fillMinimum();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Invalid option'),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('alert')),
    );
  });

  it('shows a pointValue 400 in the alert while the type is stock', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: {
            pointValue: ['pointValue is only allowed for futures'],
          },
        },
        400,
      ),
    );
    fillMinimum();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'pointValue is only allowed for futures',
      ),
    );
  });

  it('moves focus to the alert after a failed save, and to Sign in on a 401', async () => {
    setup(respond({}, 500));
    fillMinimum();
    save();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('alert')),
    );
    cleanup();
    setup(respond({}, 401));
    fillMinimum();
    save();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Sign in' }),
      ),
    );
  });

  it('shows Planned R:R from stop and target, and dashes it when the target is cleared', () => {
    setup();
    fillExampleA();
    expect(screen.queryByText('1 : 4.00')).toBeNull();
    type('Target', '5020');
    expect(screen.getByText('1 : 4.00')).toBeTruthy();
    type('Target', '');
    expect(screen.queryByText('1 : 4.00')).toBeNull();
  });

  it('dashes Planned R:R when the target or stop is on the wrong side of entry', () => {
    setup();
    fillExampleA(); // Future long, entry 5000, stop 4995
    type('Target', '4990'); // below entry on a long
    expect(screen.queryByText(/^1 : /)).toBeNull();
    type('Target', '5000'); // equal to entry
    expect(screen.queryByText(/^1 : /)).toBeNull();
    type('Target', '5020');
    expect(screen.getByText('1 : 4.00')).toBeTruthy();
    type('Stop', '5005'); // above entry on a long
    expect(screen.queryByText(/^1 : /)).toBeNull();
  });

  it('makes inputs read-only while saving', async () => {
    let resolve!: (r: Response) => void;
    setup(
      vi.fn(
        () => new Promise<Response>((r) => (resolve = r)),
      ) as unknown as typeof fetch,
    );
    fillMinimum();
    save();
    expect(field('Symbol').readOnly).toBe(true);
    type('Symbol', 'ZZZ');
    click('Short');
    expect(field('Symbol').value).toBe('AAPL');
    expect(checked('Long')).toBe(true);
    resolve(new Response(JSON.stringify(view()), { status: 201 }));
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(screen.queryByLabelText('Symbol')).toBeNull();
  });

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ])('ignores Enter during IME composition (%s)', (_n, init) => {
    const { fetchFn } = setup();
    field('Symbol').focus();
    expect(fireEvent.keyDown(field('Symbol'), { key: 'Enter', ...init })).toBe(
      true,
    );
    expect(document.activeElement).toBe(field('Symbol'));
    expect(
      fireEvent.keyDown(field('Symbol'), {
        key: 'Enter',
        ctrlKey: true,
        ...init,
      }),
    ).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['Stock', 'Long'])(
    'Enter on the %s radio moves to the next field and sends nothing',
    (name) => {
      const { fetchFn } = setup();
      const radio = screen.getByRole('radio', { name });
      radio.focus();
      expect(fireEvent.keyDown(radio, { key: 'Enter' })).toBe(false);
      expect(document.activeElement).toBe(
        name === 'Stock'
          ? screen.getByRole('radio', { name: 'Long' })
          : field('Symbol'),
      );
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it('aborts the request on unmount without warning or state updates', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn((_u: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((_r, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    }) as unknown as typeof fetch;
    setup(fetchFn);
    fillMinimum();
    save();
    expect(signal?.aborted).toBe(false);
    cleanup();
    expect(signal?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
