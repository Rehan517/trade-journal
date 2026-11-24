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
import { LAST_TRADE_KEY } from './lastTrade.ts';

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

const CLOSED = {
  id: '00000000-0000-4000-8000-000000000001',
  symbol: 'AAPL',
  instrumentType: 'stock',
  side: 'long',
  quantity: '50',
  entryPrice: '100',
  exitPrice: '105',
  fees: '1.24',
  // 09:41 and 10:20 in New York.
  openedAt: '2026-11-19T14:41:00.000Z',
  closedAt: '2026-11-19T15:20:00.000Z',
  plannedStop: '95',
  plannedTarget: '110',
  createdAt: '2026-11-19T15:21:00.000Z',
  updatedAt: '2026-11-19T15:21:00.000Z',
  metrics: { netPnl: '248.76', rMultiple: '0.99' },
};
const OPEN = {
  id: '00000000-0000-4000-8000-000000000002',
  symbol: 'MES',
  instrumentType: 'future',
  side: 'short',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  fees: '0',
  openedAt: '2026-11-19T15:30:00.000Z',
  createdAt: '2026-11-19T15:31:00.000Z',
  updatedAt: '2026-11-19T15:31:00.000Z',
  metrics: {},
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

type Call = { method: string; path: string; body: unknown };

function setup(
  respond: (call: Call) => Response | undefined = () => undefined,
  items: unknown[] = [CLOSED, OPEN],
) {
  const calls: Call[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return Promise.resolve(
      respond(call) ??
        (call.method === 'GET' ? json({ items }) : json({}, 500)),
    );
  }) as unknown as typeof fetch;
  render(<AuthView config={config} fetchFn={fetchFn} />);
  const writes = () => calls.filter((c) => c.method !== 'GET');
  const lists = () => calls.filter((c) => c.method === 'GET');
  return { calls, writes, lists };
}

const inTable = () => within(screen.getByRole('table'));
const editButton = (name: string | RegExp) =>
  inTable().findByRole('button', { name });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
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

const EDIT_AAPL = /^Edit AAPL long trade, Nov 19 · /;
const CLOSE_MES = /^Close MES short trade, Nov 19 · /;

describe('opening a trade from the list', () => {
  it('gives the symbol and Close their names, and no Close to a closed trade', async () => {
    setup();
    expect(await editButton(EDIT_AAPL)).toBeTruthy();
    expect(
      inTable().getByRole('button', { name: /^Edit MES short/ }),
    ).toBeTruthy();
    expect(inTable().getAllByRole('button', { name: /^Close / })).toHaveLength(
      1,
    );
    expect(inTable().getByRole('button', { name: CLOSE_MES })).toBeTruthy();
  });

  it('tabs from the symbol to Close within an open row', async () => {
    setup();
    await editButton(EDIT_AAPL);
    const row = inTable()
      .getByRole('button', { name: CLOSE_MES })
      .closest('tr')!;
    const order = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(order).toEqual(['MES', 'Close']);
  });

  it('opens Edit trade filled in, with times in local time', async () => {
    setup();
    fireEvent.click(await editButton(EDIT_AAPL));
    expect(screen.getByRole('heading', { name: 'Edit trade' })).toBeTruthy();
    expect(screen.getByLabelText('Symbol')).toHaveProperty('value', 'AAPL');
    expect(screen.getByLabelText('Entry time')).toHaveProperty(
      'value',
      '2026-11-19T09:41',
    );
    expect(screen.getByLabelText('Exit time')).toHaveProperty(
      'value',
      '2026-11-19T10:20',
    );
    expect(screen.getByLabelText('Fees')).toHaveProperty('value', '1.24');
    expect(document.activeElement).toBe(screen.getByLabelText('Symbol'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('opens Close trade with focus on Exit', async () => {
    setup();
    fireEvent.click(await inTable().findByRole('button', { name: CLOSE_MES }));
    expect(screen.getByRole('heading', { name: 'Close trade' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Exit'));
  });
});

describe('saving an edit', () => {
  it('sends only the changed stop', async () => {
    const { writes } = setup((c) =>
      c.method === 'PATCH' ? json({ ...CLOSED, plannedStop: '96' }) : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Stop', '96');
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    expect(writes()).toEqual([
      {
        method: 'PATCH',
        path: `/trades/${CLOSED.id}`,
        body: { plannedStop: '96' },
      },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends null for a cleared target, "0" for cleared fees and never a time that was not touched', async () => {
    const { writes } = setup((c) =>
      c.method === 'PATCH' ? json(CLOSED) : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Target', '');
    type('Fees', '');
    saveWithKeys();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ plannedTarget: null, fees: '0' });
  });

  it('sends the type and a null point value when a future becomes a stock', async () => {
    const closedFuture = { ...OPEN, id: CLOSED.id };
    const { writes } = setup(
      (c) => (c.method === 'PATCH' ? json(closedFuture) : undefined),
      [closedFuture],
    );
    fireEvent.click(await editButton(/^Edit MES short/));
    fireEvent.click(screen.getByRole('radio', { name: 'Stock' }));
    saveWithKeys();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({
      instrumentType: 'stock',
      pointValue: null,
    });
  });

  it('closes without a request or a toast when nothing changed', async () => {
    const { writes } = setup();
    fireEvent.click(await editButton(EDIT_AAPL));
    saveWithKeys();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toEqual([]);
    expect(screen.queryByText('Changes saved')).toBeNull();
  });

  it('leaves the remembered defaults alone', async () => {
    setup((c) => (c.method === 'PATCH' ? json(CLOSED) : undefined));
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Stop', '96');
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    expect(window.localStorage.getItem(LAST_TRADE_KEY)).toBeNull();
  });

  it('asks "Discard changes?" when only Side changed', async () => {
    const { writes } = setup();
    fireEvent.click(await editButton(EDIT_AAPL));
    fireEvent.click(screen.getByRole('radio', { name: /Short/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('closes an open trade: typing an exit fills the time, and the toast says Trade closed', async () => {
    const closedMes = {
      ...OPEN,
      exitPrice: '4990',
      closedAt: NOW.toISOString(),
      metrics: { netPnl: '99.00' },
    };
    let patched = false;
    const { writes, lists } = setup(
      (c) => {
        if (c.method === 'PATCH') {
          patched = true;
          return json(closedMes);
        }
        return c.method === 'GET'
          ? json({ items: [patched ? closedMes : OPEN] })
          : undefined;
      },
      [OPEN],
    );
    fireEvent.click(await inTable().findByRole('button', { name: CLOSE_MES }));
    type('Exit', '4990');
    expect(screen.getByLabelText('Exit time')).toHaveProperty(
      'value',
      '2026-11-23T10:00',
    );
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Trade closed')).toBeTruthy());
    expect(writes()[0]!.body).toEqual({
      exitPrice: '4990',
      closedAt: NOW.toISOString(),
    });
    await waitFor(() => expect(lists()).toHaveLength(2));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getByText('+$99.00'),
      ).toBeTruthy(),
    );
  });
});

describe('save errors', () => {
  async function openAndSave(status: number, body: unknown = {}) {
    const ctx = setup((c) =>
      c.method === 'PATCH' ? json(body, status) : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Stop', '96');
    saveWithKeys();
    return ctx;
  }

  it('puts a 400 on its field', async () => {
    await openAndSave(400, {
      message: 'Invalid trade',
      fieldErrors: {
        plannedStop: ['plannedStop must be below entryPrice for a long'],
      },
      formErrors: [],
    });
    await screen.findByText('Stop must be below entry for a long trade.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the deleted alert on a 404 and disables Save, and closing reloads the list', async () => {
    const { lists } = await openAndSave(404, { message: 'Trade not found' });
    await screen.findByText('This trade has been deleted.');
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveProperty('disabled', true);
    expect(lists()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(lists()).toHaveLength(2));
  });

  it('shows the changed alert on a 409 and keeps the values', async () => {
    await openAndSave(409, { message: 'Trade changed while saving' });
    await screen.findByText(
      'This trade changed while you were saving. Close it and open it again to see the latest.',
    );
    expect(screen.getByLabelText('Stop')).toHaveProperty('value', '96');
  });

  it('shows the session alert on a 401', async () => {
    await openAndSave(401);
    await screen.findByText('Your session has expired. Sign in again.');
  });

  it('words a 200 that fails parsing for an edit', async () => {
    await openAndSave(200, { nope: true });
    await screen.findByText(
      'The changes may have been saved. Check the list before saving again.',
    );
  });
});

describe('deleting', () => {
  async function askToDelete(respond?: (c: Call) => Response | undefined) {
    const ctx = setup(respond);
    fireEvent.click(await editButton(EDIT_AAPL));
    const [first] = screen.getAllByRole('button', { name: 'Delete trade' });
    fireEvent.click(first!);
    return { ...ctx, first: first! };
  }

  it('asks first, with Keep trade focused, and Esc keeps the trade', async () => {
    const { writes, first } = await askToDelete();
    expect(
      screen.getByText(/Delete this trade\? This can.t be undone\./),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Keep trade' }),
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByText(/This can.t be undone/)).toBeNull();
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('keeps the trade with Keep trade', async () => {
    const { writes } = await askToDelete();
    fireEvent.click(screen.getByRole('button', { name: 'Keep trade' }));
    expect(screen.queryByText(/This can.t be undone/)).toBeNull();
    expect(writes()).toEqual([]);
  });

  it.each([204, 404])(
    'closes on a %i, says Trade deleted, reloads and focuses the heading',
    async (status) => {
      let deleted = false;
      const { writes, lists } = await askToDelete((c) => {
        if (c.method === 'DELETE') {
          deleted = true;
          return status === 204
            ? new Response(null, { status })
            : json({ message: 'Trade not found' }, 404);
        }
        return c.method === 'GET'
          ? json({ items: deleted ? [OPEN] : [CLOSED, OPEN] })
          : undefined;
      });
      const confirm = screen.getAllByRole('button', {
        name: 'Delete trade',
      })[1]!;
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(screen.getByText('Trade deleted')).toBeTruthy(),
      );
      expect(writes()).toEqual([
        { method: 'DELETE', path: `/trades/${CLOSED.id}`, body: undefined },
      ]);
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(lists()).toHaveLength(2));
      await waitFor(() =>
        expect(inTable().queryByRole('button', { name: EDIT_AAPL })).toBeNull(),
      );
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Trades' }),
      );
    },
  );

  it('shows Deleting… while in flight', async () => {
    let release!: (r: Response) => void;
    await askToDelete((c) =>
      c.method === 'DELETE'
        ? (new Promise<Response>((r) => {
            release = r;
          }) as unknown as Response)
        : undefined,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete trade' })[1]!,
    );
    expect(
      await screen.findByRole('button', { name: 'Deleting…' }),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => release(new Response(null, { status: 204 })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the question with an alert on a 500', async () => {
    await askToDelete((c) =>
      c.method === 'DELETE'
        ? json({ message: 'Internal error' }, 500)
        : undefined,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete trade' })[1]!,
    );
    await screen.findByText(
      "Couldn't delete the trade. Check your connection and try again.",
    );
    expect(screen.getByRole('button', { name: 'Keep trade' })).toBeTruthy();
    expect(screen.queryByText('Trade deleted')).toBeNull();
  });
});

describe('gaps found in the audit', () => {
  it('gives the row buttons their full accessible names', async () => {
    setup();
    expect(
      await editButton(/^Edit AAPL long trade, Nov 19 · 0?9:41( AM)?$/),
    ).toBeTruthy();
    expect(
      inTable().getByRole('button', {
        name: /^Edit MES short trade, Nov 19 · 10:30( AM)?$/,
      }),
    ).toBeTruthy();
    expect(
      inTable().getByRole('button', {
        name: /^Close MES short trade, Nov 19 · 10:30( AM)?$/,
      }),
    ).toBeTruthy();
  });

  it('does not round an untouched time when only the notes change', async () => {
    const precise = { ...CLOSED, openedAt: '2026-11-19T14:41:30.250Z' };
    const { writes } = setup(
      (c) => (c.method === 'PATCH' ? json(precise) : undefined),
      [precise],
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Notes', 'hello');
    saveWithKeys();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ notes: 'hello' });
  });

  it('sends an edited time to the minute in UTC', async () => {
    const { writes } = setup((c) =>
      c.method === 'PATCH' ? json(CLOSED) : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Exit time', '2026-11-19T10:25');
    saveWithKeys();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toEqual({ closedAt: '2026-11-19T15:25:00.000Z' });
  });

  it('saves with Cmd+Enter and tops up fees in close mode', async () => {
    const closedMes = {
      ...OPEN,
      exitPrice: '4990',
      closedAt: NOW.toISOString(),
      fees: '1.5',
      metrics: { netPnl: '98.50', rMultiple: '1.5' },
    };
    let patched = false;
    const { writes } = setup(
      (c) => {
        if (c.method === 'PATCH') {
          patched = true;
          return json(closedMes);
        }
        return c.method === 'GET'
          ? json({ items: [patched ? closedMes : OPEN] })
          : undefined;
      },
      [OPEN],
    );
    fireEvent.click(await inTable().findByRole('button', { name: CLOSE_MES }));
    type('Exit', '4990');
    type('Fees', '1.5');
    fireEvent.keyDown(screen.getByLabelText('Notes'), {
      key: 'Enter',
      metaKey: true,
    });
    await waitFor(() => expect(screen.getByText('Trade closed')).toBeTruthy());
    expect(writes()[0]!.body).toEqual({
      exitPrice: '4990',
      closedAt: NOW.toISOString(),
      fees: '1.5',
    });
    await waitFor(() => expect(inTable().getByText('+$98.50')).toBeTruthy());
    expect(inTable().getByText('+1.50 R')).toBeTruthy();
  });

  it('says Changes saved, not Trade closed, when a closed trade is edited', async () => {
    setup((c) => (c.method === 'PATCH' ? json(CLOSED) : undefined));
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Stop', '96');
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    expect(screen.queryByText('Trade closed')).toBeNull();
  });

  it('returns focus to the button that opened the dialog after a cancel', async () => {
    setup();
    const opener = await editButton(EDIT_AAPL);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('moves focus to the heading when the reload drops the edited trade', async () => {
    let patched = false;
    setup(
      (c) => {
        if (c.method === 'PATCH') {
          patched = true;
          return json({ ...CLOSED, plannedStop: '96' });
        }
        return c.method === 'GET'
          ? json({ items: patched ? [OPEN] : [CLOSED, OPEN] })
          : undefined;
      },
      [CLOSED, OPEN],
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Stop', '96');
    saveWithKeys();
    await waitFor(() => expect(screen.getByText('Changes saved')).toBeTruthy());
    await waitFor(() =>
      expect(inTable().queryByRole('button', { name: EDIT_AAPL })).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Trades' }),
      ),
    );
  });

  it('shows the session alert on a 401 while deleting', async () => {
    setup((c) =>
      c.method === 'DELETE'
        ? json({ message: 'Unauthorized' }, 401)
        : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete trade' })[0]!,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete trade' })[1]!,
    );
    await screen.findByText('Your session has expired. Sign in again.');
    expect(screen.queryByText('Trade deleted')).toBeNull();
  });

  it('sends exactly one DELETE when the confirm button is clicked twice', async () => {
    const { writes } = setup((c) =>
      c.method === 'DELETE'
        ? (new Promise<Response>(() => undefined) as unknown as Response)
        : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete trade' })[0]!,
    );
    const confirm = screen.getAllByRole('button', { name: 'Delete trade' })[1]!;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(writes()).toHaveLength(1);
  });

  it('sends exactly one PATCH when saved twice in a row', async () => {
    const { writes } = setup((c) =>
      c.method === 'PATCH'
        ? (new Promise<Response>(() => undefined) as unknown as Response)
        : undefined,
    );
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Notes', 'twice');
    saveWithKeys();
    saveWithKeys();
    fireEvent.click(screen.getByRole('button', { name: /Sav/ }));
    expect(writes()).toHaveLength(1);
  });

  it('asks "Discard changes?" for any edit, and not when nothing changed', async () => {
    setup();
    fireEvent.click(await editButton(EDIT_AAPL));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard changes?')).toBeNull();
    fireEvent.click(await editButton(EDIT_AAPL));
    type('Notes', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard changes?')).toBeTruthy();
  });
});
