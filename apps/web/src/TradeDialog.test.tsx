import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeDialog } from './TradeDialog.tsx';
import { LAST_TRADE_KEY, type StorageLike } from './lastTrade.ts';

const apiUrl = 'https://api.example.com';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const view = (over: Record<string, unknown> = {}) => ({
  id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
  symbol: 'AAPL',
  instrumentType: 'stock',
  side: 'long',
  quantity: '1',
  entryPrice: '5',
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

type HostProps = {
  fetchFn?: typeof fetch;
  initialOpenedAt?: string;
  onClose?: () => void;
  onSaved?: (t: unknown) => void;
  // 'prop' passes the opener as returnFocusTo, 'fallback' leaves it to the
  // dialog's activeElement fallback.
  focusMode?: 'prop' | 'fallback';
  storage?: StorageLike;
};

// A stand-in for the shell: an opener button and the dialog.
function Host({
  fetchFn = respond(view(), 201),
  initialOpenedAt,
  onClose,
  onSaved,
  focusMode = 'prop',
  storage,
}: HostProps) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.focus();
          setOpener(e.currentTarget);
          setOpen(true);
        }}
      >
        Open it
      </button>
      {toast && <p role="status">Trade saved</p>}
      <TradeDialog
        open={open}
        apiUrl={apiUrl}
        accessToken="tok"
        onSignIn={() => {}}
        fetchFn={fetchFn}
        storage={storage ?? memoryStorage()}
        initialOpenedAt={initialOpenedAt}
        returnFocusTo={focusMode === 'prop' ? opener : undefined}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        onSaved={(t) => {
          setToast(true);
          onSaved?.(t);
        }}
      />
    </>
  );
}

const openIt = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
const dialog = () => document.querySelector('dialog')!;
const isOpen = () => dialog().hasAttribute('open');
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const esc = () => {
  const ev = new Event('cancel', { cancelable: true });
  fireEvent(dialog(), ev);
  return ev;
};
const cancelBtn = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
const xBtn = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
const closers = { Esc: esc, Cancel: cancelBtn, '×': xBtn };
const question = () => screen.queryByText('Discard this trade?');
const fillMinimum = () => {
  type('Symbol', 'AAPL');
  type('Qty', '1');
  type('Entry', '5');
};
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));

beforeEach(() => {
  // Only Date is faked, so waitFor and promises keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 19, 9, 30, 15));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TradeDialog opening', () => {
  it('opens with focus on Symbol and entry time now', () => {
    render(<Host />);
    expect(isOpen()).toBe(false);
    openIt();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(field('Symbol'));
    expect(field('Entry time').value).toBe('2026-11-19T09:30');
  });

  it('uses initialOpenedAt for the entry time', () => {
    render(<Host initialOpenedAt="2026-11-02T10:15" />);
    openIt();
    expect(field('Entry time').value).toBe('2026-11-02T10:15');
  });

  it('starts blank from the remembered defaults after typing, discarding and reopening', () => {
    const storage = memoryStorage();
    storage.setItem(
      LAST_TRADE_KEY,
      JSON.stringify({
        instrumentType: 'future',
        side: 'short',
        pointValue: '5',
      }),
    );
    render(<Host storage={storage} />);
    openIt();
    type('Symbol', 'ZZZ');
    type('Qty', '9');
    esc();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(isOpen()).toBe(false);
    openIt();
    expect(field('Symbol').value).toBe('');
    expect(field('Qty').value).toBe('');
    expect(field('Point value').value).toBe('');
    expect(
      (screen.getByRole('radio', { name: 'Future' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole('radio', { name: 'Short' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(question()).toBeNull();
    expect(document.activeElement).toBe(field('Symbol'));
  });
});

describe('TradeDialog closing a blank form', () => {
  it.each(Object.entries(closers))('%s closes at once', (_name, close) => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    close();
    expect(question()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(isOpen()).toBe(false);
  });

  it('prevents the browser default on cancel (Esc)', () => {
    render(<Host />);
    openIt();
    expect(esc().defaultPrevented).toBe(true);
  });
});

describe('TradeDialog discard question', () => {
  it.each(Object.entries(closers))(
    '%s with a typed symbol asks, with Keep editing focused',
    (_name, close) => {
      const onClose = vi.fn();
      render(<Host onClose={onClose} />);
      openIt();
      type('Symbol', 'AAPL');
      close();
      expect(question()).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(isOpen()).toBe(true);
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Keep editing' }),
      );
    },
  );

  it('still prevents the browser default when asking', () => {
    render(<Host />);
    openIt();
    type('Symbol', 'AAPL');
    expect(esc().defaultPrevented).toBe(true);
    expect(esc().defaultPrevented).toBe(true);
  });

  it('Keep editing keeps the values and the dialog open', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    type('Symbol', 'AAPL');
    type('Qty', '3');
    cancelBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(question()).toBeNull();
    expect(isOpen()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(field('Symbol').value).toBe('AAPL');
    expect(field('Qty').value).toBe('3');
  });

  it('Esc while the question shows keeps editing', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    type('Symbol', 'AAPL');
    esc();
    expect(question()).toBeTruthy();
    esc();
    expect(question()).toBeNull();
    expect(isOpen()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(field('Symbol').value).toBe('AAPL');
  });

  it('Discard closes the dialog', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    type('Symbol', 'AAPL');
    xBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(isOpen()).toBe(false);
  });

  it('changing only Type or Side is not dirty', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    fireEvent.click(screen.getByRole('radio', { name: 'Future' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }));
    cancelBtn();
    expect(question()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Ctrl+Enter is ignored while the question shows', async () => {
    const fetchFn = respond(view(), 201);
    render(<Host fetchFn={fetchFn} />);
    openIt();
    fillMinimum();
    cancelBtn();
    expect(question()).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), {
      key: 'Enter',
      ctrlKey: true,
    });
    await act(async () => {});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
  });
});

describe('TradeDialog scrim', () => {
  it('clicking the dialog element outside the panel does not close it', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    fireEvent.click(dialog());
    expect(onClose).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
    type('Symbol', 'AAPL');
    fireEvent.click(dialog());
    expect(question()).toBeNull();
    expect(isOpen()).toBe(true);
  });
});

describe('TradeDialog while saving', () => {
  it.each(Object.entries(closers))('%s does nothing', async (_name, close) => {
    const onClose = vi.fn();
    const fetchFn = vi.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch;
    render(<Host fetchFn={fetchFn} onClose={onClose} />);
    openIt();
    fillMinimum();
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    close();
    expect(onClose).not.toHaveBeenCalled();
    expect(question()).toBeNull();
    expect(isOpen()).toBe(true);
    expect(field('Symbol').value).toBe('AAPL');
  });
});

describe('TradeDialog after a 201', () => {
  it.each([['prop' as const], ['fallback' as const]])(
    'closes, calls onSaved, shows the toast and returns focus (%s)',
    async (focusMode) => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(
        <Host focusMode={focusMode} onSaved={onSaved} onClose={onClose} />,
      );
      const opener = screen.getByRole('button', { name: 'Open it' });
      openIt();
      fillMinimum();
      save();
      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledWith(view());
      expect(onClose).toHaveBeenCalledOnce();
      expect(isOpen()).toBe(false);
      // The toast is a state update React renders after onSaved returns.
      expect(await screen.findByText('Trade saved')).toBeTruthy();
      // Focus goes back once React has committed the close.
      await waitFor(() => expect(document.activeElement).toBe(opener));
    },
  );

  it('returns focus to the opener after a discard too', () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    openIt();
    type('Symbol', 'AAPL');
    cancelBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(document.activeElement).toBe(opener);
  });
});

describe('TradeDialog errors keep it open', () => {
  it.each([
    [
      400,
      {
        message: 'Invalid trade',
        fieldErrors: { quantity: ['quantity must be positive'] },
      },
    ],
    [401, { message: 'Unauthorized' }],
    [500, { message: 'Boom' }],
  ])('a %i keeps the dialog open with the values', async (status, body) => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchFn = respond(body, status);
    render(<Host fetchFn={fetchFn} onSaved={onSaved} onClose={onClose} />);
    openIt();
    fillMinimum();
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    // A field-only 400 shows its message on the cell, not in an alert, so
    // wait for the save to settle (inputs are read-only while it runs).
    await waitFor(() => expect(field('Symbol').readOnly).toBe(false));
    await act(async () => {});
    expect(isOpen()).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Trade saved')).toBeNull();
    expect(field('Symbol').value).toBe('AAPL');
    expect(field('Qty').value).toBe('1');
    expect(field('Entry').value).toBe('5');
  });
});

describe('review fixes', () => {
  it('handles Esc on keydown, so a second Esc on the question keeps editing', () => {
    render(<Host />);
    openIt();
    type('Symbol', 'MES');
    const first = fireEvent.keyDown(field('Symbol'), { key: 'Escape' });
    expect(first).toBe(false); // prevented: the browser never starts a close
    expect(question()).toBeTruthy();
    const second = fireEvent.keyDown(
      screen.getByRole('button', { name: 'Keep editing' }),
      { key: 'Escape' },
    );
    expect(second).toBe(false);
    expect(question()).toBeNull();
    expect(isOpen()).toBe(true);
    expect(field('Symbol').value).toBe('MES');
  });

  it('reopens itself if the browser closes it without asking', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    openIt();
    type('Symbol', 'MES');
    act(() => dialog().close()); // e.g. an uncancelable cancel in Chrome
    expect(isOpen()).toBe(true);
    expect(field('Symbol').value).toBe('MES');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives focus to Cancel after Cancel, then Keep editing', () => {
    render(<Host />);
    openIt();
    type('Symbol', 'MES');
    // A real click focuses the button first (jsdom doesn't).
    act(() => screen.getByRole('button', { name: 'Cancel' }).focus());
    cancelBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    );
  });

  it('keeps Symbol quiet when the trader leaves it untouched after opening', () => {
    render(<Host />);
    openIt();
    expect(document.activeElement).toBe(field('Symbol'));
    act(() => field('Qty').focus()); // e.g. a click on Future or Shift+Tab
    expect(field('Symbol').getAttribute('aria-invalid')).toBeNull();
    // A real visit still shows the error on blur.
    act(() => field('Symbol').focus());
    act(() => field('Qty').focus());
    expect(field('Symbol').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the shortcut hint in the footer', () => {
    render(<Host />);
    openIt();
    expect(
      screen.getByText(/(⌘ Enter|Ctrl\+Enter) to save · Esc to close/),
    ).toBeTruthy();
  });

  it('closes the dialog before calling onSaved, so the page is live for the toast', async () => {
    let openWhenSaved: boolean | undefined;
    render(<Host onSaved={() => (openWhenSaved = isOpen())} />);
    openIt();
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '5');
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
    await waitFor(() => expect(openWhenSaved).toBe(false));
  });
});
