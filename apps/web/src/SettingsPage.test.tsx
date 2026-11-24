import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './FormParts.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { useState } from 'react';
import { useSymbols } from './useSymbols.ts';

const apiUrl = 'https://api.example.com';

type Call = { method: string; path: string; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A tiny in-memory API for /symbols, with hooks to make a request fail. */
function server(
  initial: Record<string, string> = {},
  fail: (call: Call) => Response | undefined = () => undefined,
) {
  const store = new Map(Object.entries(initial));
  const calls: Call[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const failed = fail(call);
    if (failed) return Promise.resolve(failed);
    const root = call.path.split('/')[2] ?? '';
    if (call.method === 'GET') {
      return Promise.resolve(
        json({
          items: [...store].map(([r, pointValue]) => ({
            root: r,
            pointValue,
            updatedAt: '2026-11-19T14:31:00.000Z',
          })),
        }),
      );
    }
    if (call.method === 'PUT') {
      const pointValue = (call.body as { pointValue: string }).pointValue;
      store.set(root, pointValue);
      return Promise.resolve(
        json({ root, pointValue, updatedAt: '2026-11-19T14:32:00.000Z' }),
      );
    }
    store.delete(root);
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as unknown as typeof fetch;
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { fetchFn, calls, writes, store };
}

function Host({
  fetchFn,
  token = 'tok',
  onSignIn = () => {},
}: {
  fetchFn: typeof fetch;
  token?: string | undefined;
  onSignIn?: () => void;
}) {
  const symbols = useSymbols(apiUrl, token, fetchFn);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  return (
    <>
      <SettingsPage
        apiUrl={apiUrl}
        accessToken={token}
        onSignIn={onSignIn}
        fetchFn={fetchFn}
        symbols={symbols}
        announce={(message) =>
          setToast((t) => ({ id: (t?.id ?? 0) + 1, message }))
        }
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

const rowOf = (root: string) =>
  screen
    .getByRole('rowheader', { name: new RegExp(`^${root}`) })
    .closest('tr')!;
const cells = (root: string) =>
  within(rowOf(root))
    .getAllByRole('cell')
    .map((c) => c.textContent);
const rootsShown = () =>
  within(screen.getByRole('table'))
    .getAllByRole('rowheader')
    .map((h) => h.childNodes[0]?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const ready = () =>
  waitFor(() => expect(screen.queryByText('Loading saved values…')).toBeNull());

afterEach(cleanup);

describe('Settings table', () => {
  it('merges defaults and saved values, sorted by root, with each Source', async () => {
    const api = server({ NQ: '25', ZZZ: '3', ES: '50' });
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    expect(rootsShown()).toEqual([
      'CL',
      'ES',
      'GC',
      'M2K',
      'MCL',
      'MES',
      'MGC',
      'MNQ',
      'MYM',
      'NG',
      'NQ',
      'RTY',
      'SI',
      'YM',
      'ZZZ',
    ]);
    // Cells: value, source (column), actions. The phone's second line repeats Source.
    expect(cells('CL')).toEqual(['$1,000', 'Default', 'Edit']);
    expect(cells('MYM')).toEqual(['$0.50', 'Default', 'Edit']);
    expect(cells('NQ')).toEqual([
      '$25',
      'Saved · default $20',
      'EditUse default',
    ]);
    expect(cells('ES')).toEqual([
      '$50',
      'Saved · default $50',
      'EditUse default',
    ]);
    expect(cells('ZZZ')).toEqual(['$3', 'Saved', 'EditRemove']);
    expect(
      screen.getByRole('table', { name: 'Point values by contract root' }),
    ).toBeTruthy();
  });

  it('shows the defaults and a status while saved values load', async () => {
    const api = server({ MES: '6' });
    render(<Host fetchFn={api.fetchFn} />);
    expect(screen.getByText('Loading saved values…')).toBeTruthy();
    expect(cells('MES')[0]).toBe('$5');
    await waitFor(() => expect(cells('MES')[0]).toBe('$6'));
    expect(screen.queryByText('Loading saved values…')).toBeNull();
  });

  it('says what the page is for', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    expect(
      screen.getByText(
        'Dollars per 1.00 point, per contract. Trades already logged keep their own value.',
      ),
    ).toBeTruthy();
  });
});

describe('load states', () => {
  it('shows an alert with Retry above the defaults, and Retry loads again', async () => {
    let fail = true;
    const api = server({ MES: '6' }, (c) =>
      fail && c.method === 'GET' ? json({}, 500) : undefined,
    );
    render(<Host fetchFn={api.fetchFn} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      "Couldn't load your saved point values.",
    );
    expect(cells('MES')[0]).toBe('$5');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cells('MES')[0]).toBe('$6'));
    expect(screen.queryByRole('alert')).toBeNull();
    // Retry took its button away, so focus moved to the page title.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1 }),
      ),
    );
  });

  it('shows the session alert on a 401', async () => {
    const onSignIn = vi.fn();
    const api = server({}, () => json({ message: 'Unauthorized' }, 401));
    render(<Host fetchFn={api.fetchFn} onSignIn={onSignIn} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your session has expired.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

describe('editing a row', () => {
  it('Edit puts focus in the field; Enter saves, toasts and returns focus to Edit', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    const input = screen.getByLabelText('Point value for MES');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLInputElement).value).toBe('5');
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cells('MES')[0]).toBe('$6'));
    expect(api.writes()).toEqual([
      { method: 'PUT', path: '/symbols/MES', body: { pointValue: '6' } },
    ]);
    expect(screen.getByText('Point value saved')).toBeTruthy();
    expect(cells('MES')[1]).toBe('Saved · default $5');
    await waitFor(() =>
      expect(document.activeElement).toBe(button('Edit MES')),
    );
  });

  it('Save sends the same PUT as Enter', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit NQ'));
    fireEvent.change(screen.getByLabelText('Point value for NQ'), {
      target: { value: '25' },
    });
    fireEvent.click(button('Save'));
    await waitFor(() => expect(cells('NQ')[0]).toBe('$25'));
    expect(api.writes()).toHaveLength(1);
  });

  it('Esc cancels without a request and returns focus to Edit', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    const input = screen.getByLabelText('Point value for MES');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Point value for MES')).toBeNull();
    expect(cells('MES')[0]).toBe('$5');
    await waitFor(() =>
      expect(document.activeElement).toBe(button('Edit MES')),
    );
    expect(api.writes()).toHaveLength(0);
  });

  it('Cancel does the same as Esc', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    fireEvent.click(button('Cancel'));
    expect(screen.queryByLabelText('Point value for MES')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(button('Edit MES')),
    );
  });

  it('a bad value shows the copy, sends nothing and keeps focus in the field', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    const input = screen.getByLabelText('Point value for MES');
    fireEvent.change(input, { target: { value: '5e1' } });
    fireEvent.click(button('Save'));
    const error = screen.getByText('Enter dollars per point, like 5.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(document.activeElement).toBe(input);
    expect(api.writes()).toHaveLength(0);
    fireEvent.change(input, { target: { value: '5.5' } });
    expect(screen.queryByText('Enter dollars per point, like 5.')).toBeNull();
  });

  it('a failed save says so in the row and keeps what was typed', async () => {
    const api = server({}, (c) =>
      c.method === 'PUT' ? json({}, 500) : undefined,
    );
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    const input = screen.getByLabelText('Point value for MES');
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.click(button('Save'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't save. Check your connection and try again.",
    );
    expect(
      (screen.getByLabelText('Point value for MES') as HTMLInputElement).value,
    ).toBe('6');
    expect(screen.queryByText('Point value saved')).toBeNull();
  });

  it('a 401 on save shows the session alert and keeps what was typed', async () => {
    const api = server({}, (c) =>
      c.method === 'PUT' ? json({ message: 'Unauthorized' }, 401) : undefined,
    );
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Edit MES'));
    fireEvent.change(screen.getByLabelText('Point value for MES'), {
      target: { value: '6' },
    });
    fireEvent.click(button('Save'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your session has expired.');
    expect(
      (screen.getByLabelText('Point value for MES') as HTMLInputElement).value,
    ).toBe('6');
  });
});

describe('Remove and Use default', () => {
  it('Remove sends DELETE, toasts, drops the row and focuses the next Edit', async () => {
    const api = server({ AAA: '3' });
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    expect(rootsShown()[0]).toBe('AAA');
    fireEvent.click(button('Remove AAA'));
    await waitFor(() => expect(rootsShown()[0]).toBe('CL'));
    expect(api.writes()).toEqual([
      { method: 'DELETE', path: '/symbols/AAA', body: undefined },
    ]);
    expect(screen.getByText('Point value removed')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(button('Edit CL')));
  });

  it('Remove on the last row moves focus to the Add form Symbol field', async () => {
    const api = server({ ZZZ: '3' });
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Remove ZZZ'));
    await waitFor(() => expect(rootsShown()).not.toContain('ZZZ'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Symbol')),
    );
  });

  it('Use default sends DELETE, restores the default and keeps focus on Edit', async () => {
    const api = server({ NQ: '25' });
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Use default for NQ'));
    await waitFor(() =>
      expect(cells('NQ')).toEqual(['$20', 'Default', 'Edit']),
    );
    expect(api.writes()).toEqual([
      { method: 'DELETE', path: '/symbols/NQ', body: undefined },
    ]);
    expect(screen.getByText('Default restored')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(button('Edit NQ')));
  });

  it('a failed removal says so in the row and keeps the row', async () => {
    const api = server({ ZZZ: '3' }, (c) =>
      c.method === 'DELETE' ? json({}, 500) : undefined,
    );
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Remove ZZZ'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't save. Check your connection and try again.",
    );
    expect(cells('ZZZ')[0]).toBe('$3');
  });
});

describe('Add a symbol', () => {
  const symbolField = () => screen.getByLabelText('Symbol') as HTMLInputElement;
  const pointField = () =>
    screen.getByLabelText('Point value') as HTMLInputElement;
  const type = (el: HTMLElement, value: string) =>
    fireEvent.change(el, { target: { value } });

  it('shows what the symbol saves as, live', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    type(symbolField(), 'MESZ6');
    expect(screen.getByText('Saves as MES.')).toBeTruthy();
    type(symbolField(), 'mes1!');
    expect(screen.getByText('Saves as MES.')).toBeTruthy();
    type(symbolField(), '/ES');
    expect(screen.getByText('Saves as ES.')).toBeTruthy();
    expect(symbolField().getAttribute('aria-describedby')).toBe(
      screen.getByText('Saves as ES.').id,
    );
  });

  it('sends a PUT for the root, updates the row, clears the fields and focuses Symbol', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    type(symbolField(), 'MESZ6');
    type(pointField(), '6');
    fireEvent.click(button('Add'));
    await waitFor(() => expect(cells('MES')[0]).toBe('$6'));
    expect(api.writes()).toEqual([
      { method: 'PUT', path: '/symbols/MES', body: { pointValue: '6' } },
    ]);
    expect(screen.getByText('Point value saved')).toBeTruthy();
    // An existing root is updated, not duplicated.
    expect(rootsShown().filter((r) => r === 'MES')).toHaveLength(1);
    expect(symbolField().value).toBe('');
    expect(pointField().value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(symbolField()));
  });

  it('adds a root that has no default as a new Saved row', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    type(symbolField(), 'ZNZ6');
    type(pointField(), '1000');
    fireEvent.click(button('Add'));
    await waitFor(() =>
      expect(cells('ZN')).toEqual(['$1,000', 'Saved', 'EditRemove']),
    );
  });

  it('shows the validation copy on save and sends nothing', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    fireEvent.click(button('Add'));
    expect(screen.getByText('Enter a futures symbol, like MES.')).toBeTruthy();
    expect(screen.getByText('Enter dollars per point, like 5.')).toBeTruthy();
    expect(document.activeElement).toBe(symbolField());
    type(symbolField(), 'BRK.B');
    expect(screen.getByText('Use letters and numbers only.')).toBeTruthy();
    expect(api.writes()).toHaveLength(0);
  });

  it('shows the copy on blur, not while typing', async () => {
    const api = server();
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    type(pointField(), 'abc');
    expect(screen.queryByText('Enter dollars per point, like 5.')).toBeNull();
    fireEvent.blur(pointField());
    expect(screen.getByText('Enter dollars per point, like 5.')).toBeTruthy();
    expect(pointField().getAttribute('aria-invalid')).toBe('true');
  });

  it('a failed add says so and keeps what was typed', async () => {
    const api = server({}, (c) =>
      c.method === 'PUT' ? json({}, 500) : undefined,
    );
    render(<Host fetchFn={api.fetchFn} />);
    await ready();
    type(symbolField(), 'MES');
    type(pointField(), '6');
    fireEvent.click(button('Add'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      "Couldn't save. Check your connection and try again.",
    );
    expect(symbolField().value).toBe('MES');
    expect(pointField().value).toBe('6');
  });
});
