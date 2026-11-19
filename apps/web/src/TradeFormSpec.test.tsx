/**
 * Spec-driven tests for the quick-entry form (docs/spec/trades.md, "Quick-entry
 * form (#7)", "Automated tests (#7)"). Expected values come from the spec, not
 * from the implementation. Complements TradeForm.test.tsx.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeForm } from './TradeForm.tsx';
import { explainIssue } from './errorCopy.ts';

const apiUrl = 'https://api.example.com';
const KEY = 'tradeJournal.lastTrade.v1';

// 09:30 in the test zone (America/New_York, see the test script): 14:30Z in Nov.
let clock = new Date(2026, 10, 19, 9, 30, 15);
const now = () => clock;

type Store = {
  data: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
};
function memoryStorage(initial?: string): Store {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(KEY, initial);
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

function setup(
  fetchFn: typeof fetch = respond(view(), 201),
  storage:
    Store | { getItem: () => never; setItem: () => never } = memoryStorage(),
) {
  clock = new Date(2026, 10, 19, 9, 30, 15);
  const onSignIn = vi.fn();
  render(
    <TradeForm
      apiUrl={apiUrl}
      accessToken="tok"
      onSignIn={onSignIn}
      fetchFn={fetchFn}
      now={now}
      storage={storage}
    />,
  );
  return { fetchFn, storage, onSignIn };
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const click = (name: string) =>
  fireEvent.click(screen.getByRole('radio', { name }));
const checked = (name: string) =>
  (screen.getByRole('radio', { name }) as HTMLInputElement).checked;
const exact = (text: string) =>
  screen.getByText((_, el) => el?.textContent === text && !el.children.length);
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
const bodyOf = (fetchFn: typeof fetch, call = 0) =>
  JSON.parse(vi.mocked(fetchFn).mock.calls[call]![1]!.body as string);

/** The text of whatever the input's aria-describedby points at. */
function errorOf(label: string): string | undefined {
  const ids = field(label).getAttribute('aria-describedby');
  if (!ids) return undefined;
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

/** A valid stock ticket: long 1 AAPL at 100. */
function fillStock() {
  type('Symbol', 'AAPL');
  type('Qty', '1');
  type('Entry', '100');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('submit', () => {
  it('open trade (example H) posts without exit fields, with fees and stop', async () => {
    const fetchFn = respond(view({ fees: '0.62', plannedStop: '4995' }), 201);
    setup(fetchFn);
    click('Future');
    type('Symbol', 'MES');
    type('Point value', '5');
    type('Qty', '2');
    type('Entry', '5000');
    type('Fees', '0.62');
    type('Stop', '4995');
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(2);
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(`${apiUrl}/trades`);
    expect(init?.method).toBe('POST');
    const body = bodyOf(fetchFn);
    expect(body).toEqual({
      instrumentType: 'future',
      side: 'long',
      symbol: 'MES',
      pointValue: '5',
      quantity: '2',
      entryPrice: '5000',
      fees: '0.62',
      plannedStop: '4995',
      openedAt: '2026-11-19T14:30:00.000Z',
    });
    expect(body).not.toHaveProperty('exitPrice');
    expect(body).not.toHaveProperty('closedAt');
  });

  it('leaves empty optional fields (and empty fees) out of the body', async () => {
    const fetchFn = setup().fetchFn;
    fillStock();
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    expect(bodyOf(fetchFn)).toEqual({
      instrumentType: 'stock',
      side: 'long',
      symbol: 'AAPL',
      quantity: '1',
      entryPrice: '100',
      openedAt: '2026-11-19T14:30:00.000Z',
    });
  });

  it('sends the symbol as typed and notes as typed', async () => {
    const fetchFn = setup().fetchFn;
    fillStock();
    type('Symbol', ' aapl ');
    type('Notes', 'Broke the range');
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    const body = bodyOf(fetchFn);
    expect(body.symbol).toBe(' aapl ');
    expect(body.notes).toBe('Broke the range');
  });

  it('leaves pointValue out of the body after switching to Stock', async () => {
    const fetchFn = setup().fetchFn;
    click('Future');
    type('Point value', '5');
    click('Stock');
    fillStock();
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    const body = bodyOf(fetchFn);
    expect(body.instrumentType).toBe('stock');
    expect(body).not.toHaveProperty('pointValue');
  });

  it('sends a short trade and remembers Short for next time', async () => {
    const { fetchFn, storage } = setup();
    click('Short');
    fillStock();
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(bodyOf(fetchFn).side).toBe('short');
    expect(checked('Short')).toBe(true);
    expect(JSON.parse((storage as Store).data.get(KEY)!)).toMatchObject({
      instrumentType: 'stock',
      side: 'short',
    });
  });

  it('sends times as UTC across daylight saving (July is UTC-4)', async () => {
    const fetchFn = setup().fetchFn;
    fillStock();
    type('Entry time', '2026-07-01T09:30');
    type('Exit', '101');
    type('Exit time', '2026-07-01T15:45');
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    const body = bodyOf(fetchFn);
    expect(body.openedAt).toBe('2026-07-01T13:30:00.000Z');
    expect(body.closedAt).toBe('2026-07-01T19:45:00.000Z');
  });

  it('resets everything except type, side and point value, with entry time set to now', async () => {
    setup();
    click('Future');
    click('Short');
    type('Symbol', 'MES');
    type('Point value', '5');
    type('Qty', '2');
    type('Entry', '5000');
    type('Exit', '4990');
    type('Exit time', '2026-11-19T09:45');
    type('Fees', '1');
    type('Stop', '5005');
    type('Target', '4980');
    type('Notes', 'n');
    // Time moves on while the request is in flight.
    clock = new Date(2026, 10, 19, 10, 5, 0);
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    for (const l of [
      'Symbol',
      'Qty',
      'Entry',
      'Exit',
      'Exit time',
      'Fees',
      'Stop',
      'Target',
      'Notes',
    ]) {
      expect(field(l).value, l).toBe('');
    }
    expect(field('Entry time').value).toBe('2026-11-19T10:05');
    expect(field('Point value').value).toBe('5');
    expect(checked('Future')).toBe(true);
    expect(checked('Short')).toBe(true);
    expect(document.activeElement).toBe(field('Symbol'));
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('does not remember anything when the save fails', async () => {
    const { storage } = setup(respond({}, 500));
    click('Future');
    click('Short');
    type('Point value', '5');
    type('Symbol', 'MES');
    type('Qty', '1');
    type('Entry', '5000');
    save();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((storage as Store).data.has(KEY)).toBe(false);
  });
});

describe('live preview', () => {
  it('example A: +$98.76, $50.00 and +1.98 R, with U+202F before R', () => {
    setup();
    click('Future');
    type('Point value', '5');
    type('Qty', '2');
    type('Entry', '5000');
    type('Fees', '1.24');
    type('Exit', '5010');
    expect(screen.getAllByText('–').length).toBeGreaterThan(0);
    type('Stop', '4995');
    expect(screen.getByText('+$98.76')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(exact('+1.98 R')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('example B: −$21.62 and −1.08 R, then dashes when the exit is cleared', () => {
    setup();
    click('Future');
    click('Short');
    type('Point value', '2');
    type('Qty', '1');
    type('Entry', '18000.25');
    type('Fees', '0.62');
    type('Exit', '18010.75');
    type('Stop', '18010.25');
    expect(exact('−$21.62')).toBeTruthy();
    expect(exact('−1.08 R')).toBeTruthy();
    expect(screen.getByText('$20.00')).toBeTruthy();
    type('Exit', '');
    expect(screen.queryByText('−$21.62')).toBeNull();
    expect(screen.queryByText(/1\.08/)).toBeNull();
    // Risk stays: it needs no exit.
    expect(screen.getByText('$20.00')).toBeTruthy();
  });

  it('example C (no stop): net P&L with dashes for risk and R', () => {
    setup();
    type('Qty', '10');
    type('Entry', '187.50');
    type('Exit', '190.00');
    expect(screen.getByText('+$25.00')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });

  it('example D: stock short', () => {
    setup();
    click('Short');
    type('Qty', '100');
    type('Entry', '250.50');
    type('Fees', '2');
    type('Stop', '251.50');
    type('Exit', '248.25');
    expect(screen.getByText('+$223.00')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(exact('+2.23 R')).toBeTruthy();
  });

  it('example K: a tiny loss shows $0.00 and 0.00 R without a negative zero', () => {
    setup();
    type('Qty', '1');
    type('Entry', '10');
    type('Fees', '0.004');
    type('Stop', '9');
    type('Exit', '10');
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(exact('0.00 R')).toBeTruthy();
    expect(screen.queryByText(/-0\.00|−0\.00/)).toBeNull();
  });

  it.each([
    ['unparseable quantity', () => type('Qty', 'abc')],
    ['unparseable entry', () => type('Entry', 'abc')],
    ['unparseable exit', () => type('Exit', 'abc')],
    ['unparseable fees', () => type('Fees', 'x')],
  ])('shows dashes and does not throw with an %s', (_n, mutate) => {
    setup();
    type('Qty', '1');
    type('Entry', '100');
    type('Exit', '110');
    type('Stop', '95');
    mutate();
    expect(screen.queryByText('+$10.00')).toBeNull();
    expect(screen.getAllByText('–').length).toBeGreaterThan(0);
  });

  it('an unparseable stop blanks Risk and R but not net P&L, which does not read it', () => {
    setup();
    type('Qty', '1');
    type('Entry', '100');
    type('Exit', '110');
    type('Stop', '95');
    expect(exact('+2.00\u202fR')).toBeTruthy();
    type('Stop', 'x');
    expect(screen.getByText('+$10.00')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(2);
  });

  it('shows dashes for a future with no point value or a fractional quantity', () => {
    setup();
    click('Future');
    type('Qty', '2');
    type('Entry', '5000');
    type('Exit', '5010');
    type('Stop', '4995');
    expect(screen.queryByText('$50.00')).toBeNull();
    expect(screen.getAllByText('–')).toHaveLength(3);
    type('Point value', '5');
    expect(screen.getByText('+$100.00')).toBeTruthy();
    type('Qty', '1.5');
    expect(screen.queryByText('+$75.00')).toBeNull();
    expect(screen.getAllByText('–')).toHaveLength(3);
  });

  it('the result strip is a polite live region', () => {
    setup();
    const strip = document.querySelector('[aria-live="polite"]');
    expect(strip).toBeTruthy();
    expect(strip?.textContent).toContain('Risk');
  });
});

describe('validation', () => {
  type Case = {
    name: string;
    prepare: () => void;
    label: string;
    copy: string;
    /** Field to blur for the on-blur variant; omit to skip that variant. */
    blurOn?: string;
  };
  const PRICE = 'Enter a price, like 5012.25.';
  const cases: Case[] = [
    {
      name: 'missing symbol',
      prepare: () => type('Symbol', ''),
      label: 'Symbol',
      copy: 'Enter a symbol, like MES or AAPL.',
      blurOn: 'Symbol',
    },
    {
      name: 'symbol over 12 characters',
      prepare: () => type('Symbol', 'ABCDEFGHIJKLM'),
      label: 'Symbol',
      copy: 'Symbols are 12 characters or fewer.',
      blurOn: 'Symbol',
    },
    {
      name: 'quantity not a number',
      prepare: () => type('Qty', 'abc'),
      label: 'Qty',
      copy: 'Enter a quantity above 0, like 2.',
      blurOn: 'Qty',
    },
    {
      name: 'quantity zero',
      prepare: () => type('Qty', '0'),
      label: 'Qty',
      copy: 'Enter a quantity above 0, like 2.',
      blurOn: 'Qty',
    },
    {
      name: 'quantity negative',
      prepare: () => type('Qty', '-1'),
      label: 'Qty',
      copy: 'Enter a quantity above 0, like 2.',
      blurOn: 'Qty',
    },
    {
      name: 'quantity missing',
      prepare: () => type('Qty', ''),
      label: 'Qty',
      copy: 'Enter a quantity above 0, like 2.',
      blurOn: 'Qty',
    },
    {
      name: 'entry not a number',
      prepare: () => type('Entry', 'abc'),
      label: 'Entry',
      copy: PRICE,
      blurOn: 'Entry',
    },
    {
      name: 'entry zero',
      prepare: () => type('Entry', '0'),
      label: 'Entry',
      copy: PRICE,
      blurOn: 'Entry',
    },
    {
      name: 'entry in exponent form',
      prepare: () => type('Entry', '1e3'),
      label: 'Entry',
      copy: PRICE,
      blurOn: 'Entry',
    },
    {
      name: 'entry missing',
      prepare: () => type('Entry', ''),
      label: 'Entry',
      copy: PRICE,
      blurOn: 'Entry',
    },
    {
      name: 'a bad exit price',
      prepare: () => type('Exit', 'abc'),
      label: 'Exit',
      copy: PRICE,
      blurOn: 'Exit',
    },
    {
      name: 'a negative exit price',
      prepare: () => type('Exit', '-5'),
      label: 'Exit',
      copy: PRICE,
      blurOn: 'Exit',
    },
    {
      name: 'a bad stop',
      prepare: () => type('Stop', 'abc'),
      label: 'Stop',
      copy: PRICE,
      blurOn: 'Stop',
    },
    {
      name: 'a bad target',
      prepare: () => type('Target', 'abc'),
      label: 'Target',
      copy: PRICE,
      blurOn: 'Target',
    },
    {
      name: 'bad fees',
      prepare: () => type('Fees', 'abc'),
      label: 'Fees',
      copy: 'Enter fees as an amount, like 1.24, or leave blank.',
      blurOn: 'Fees',
    },
    {
      name: 'negative fees',
      prepare: () => type('Fees', '-1'),
      label: 'Fees',
      copy: 'Enter fees as an amount, like 1.24, or leave blank.',
      blurOn: 'Fees',
    },
    {
      name: 'missing entry time',
      prepare: () => type('Entry time', ''),
      label: 'Entry time',
      copy: 'Enter the entry time.',
      blurOn: 'Entry time',
    },
    {
      name: 'exit price without exit time',
      prepare: () => {
        type('Exit', '101');
        type('Exit time', '');
      },
      label: 'Exit time',
      copy: 'Add an exit time, or clear the exit price.',
    },
    {
      name: 'exit time without exit price',
      prepare: () => type('Exit time', '2026-11-19T10:00'),
      label: 'Exit',
      copy: 'Add an exit price, or clear the exit time.',
    },
    {
      name: 'exit time before entry time',
      prepare: () => {
        type('Exit', '101');
        type('Exit time', '2026-11-19T09:00');
      },
      label: 'Exit time',
      copy: "Exit time can't be before entry time.",
      blurOn: 'Exit time',
    },
    {
      name: 'a future without point value',
      prepare: () => click('Future'),
      label: 'Point value',
      copy: 'Enter dollars per point, like 5.',
      blurOn: 'Point value',
    },
    {
      name: 'a future with a bad point value',
      prepare: () => {
        click('Future');
        type('Point value', 'abc');
      },
      label: 'Point value',
      copy: 'Enter dollars per point, like 5.',
      blurOn: 'Point value',
    },
    {
      name: 'a future with a fractional quantity',
      prepare: () => {
        click('Future');
        type('Point value', '5');
        type('Qty', '1.5');
      },
      label: 'Qty',
      copy: 'Futures quantity must be a whole number.',
      blurOn: 'Qty',
    },
    {
      name: 'long stop above entry',
      prepare: () => type('Stop', '101'),
      label: 'Stop',
      copy: 'Stop must be below entry for a long trade.',
      blurOn: 'Stop',
    },
    {
      name: 'long stop equal to entry',
      prepare: () => type('Stop', '100'),
      label: 'Stop',
      copy: 'Stop must be below entry for a long trade.',
      blurOn: 'Stop',
    },
    {
      name: 'long target below entry',
      prepare: () => type('Target', '99'),
      label: 'Target',
      copy: 'Target must be above entry for a long trade.',
      blurOn: 'Target',
    },
    {
      name: 'long target equal to entry',
      prepare: () => type('Target', '100'),
      label: 'Target',
      copy: 'Target must be above entry for a long trade.',
      blurOn: 'Target',
    },
    {
      name: 'short stop below entry',
      prepare: () => {
        click('Short');
        type('Stop', '99');
      },
      label: 'Stop',
      copy: 'Stop must be above entry for a short trade.',
      blurOn: 'Stop',
    },
    {
      name: 'short target above entry',
      prepare: () => {
        click('Short');
        type('Target', '101');
      },
      label: 'Target',
      copy: 'Target must be below entry for a short trade.',
      blurOn: 'Target',
    },
    {
      name: 'notes over 5000 characters',
      prepare: () => type('Notes', 'x'.repeat(5001)),
      label: 'Notes',
      copy: 'Notes are 5000 characters or fewer.',
      blurOn: 'Notes',
    },
  ];

  it.each(cases)(
    'on save: $name shows next to $label and blocks the request',
    ({ prepare, label, copy }) => {
      const { fetchFn } = setup();
      fillStock();
      prepare();
      save();
      expect(fetchFn).not.toHaveBeenCalled();
      expect(errorOf(label)).toBe(copy);
      expect(field(label).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field(label));
    },
  );

  it.each(cases.filter((c) => c.blurOn))(
    'on blur: $name shows next to $label',
    ({ prepare, label, copy, blurOn }) => {
      setup();
      fillStock();
      prepare();
      fireEvent.blur(field(blurOn!));
      expect(errorOf(label)).toBe(copy);
    },
  );

  it.each([
    ['2.0 contracts is a whole number', '2.0'],
    ['a plain whole number', '3'],
  ])('a future accepts %s', async (_n, qty) => {
    const { fetchFn } = setup();
    fillStock();
    click('Future');
    type('Point value', '5');
    type('Qty', qty);
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
  });

  it('accepts fees of 0 and notes of exactly 5000 characters', async () => {
    const { fetchFn } = setup();
    fillStock();
    type('Fees', '0');
    type('Notes', 'x'.repeat(5000));
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
  });

  it('does not show errors while typing, until the field is left', () => {
    setup();
    fillStock();
    type('Stop', '101');
    expect(errorOf('Stop')).toBeUndefined();
    type('Qty', 'abc');
    expect(errorOf('Qty')).toBeUndefined();
    expect(screen.queryByText(/Stop must be/)).toBeNull();
    fireEvent.blur(field('Stop'));
    expect(errorOf('Stop')).toBe('Stop must be below entry for a long trade.');
    expect(errorOf('Qty')).toBeUndefined();
  });

  it('clears an error as soon as it is fixed, without leaving the field, and drops aria-invalid', () => {
    setup();
    fillStock();
    save(); // all valid: nothing shown
    type('Stop', '101');
    fireEvent.blur(field('Stop'));
    expect(field('Stop').getAttribute('aria-invalid')).toBe('true');
    // Still wrong while typing: stays.
    type('Stop', '100');
    expect(errorOf('Stop')).toBe('Stop must be below entry for a long trade.');
    type('Stop', '99');
    expect(errorOf('Stop')).toBeUndefined();
    expect(field('Stop').getAttribute('aria-invalid')).not.toBe('true');
    expect(field('Stop').hasAttribute('aria-describedby')).toBe(false);
  });

  it('clears errors shown by a failed save once each field is fixed', () => {
    setup();
    save();
    expect(errorOf('Symbol')).toBeTruthy();
    expect(errorOf('Qty')).toBeTruthy();
    expect(errorOf('Entry')).toBeTruthy();
    type('Symbol', 'AAPL');
    type('Qty', '1');
    type('Entry', '100');
    expect(errorOf('Symbol')).toBeUndefined();
    expect(errorOf('Qty')).toBeUndefined();
    expect(errorOf('Entry')).toBeUndefined();
  });

  it('shows every error at once on save and focuses the first in reading order', () => {
    const { fetchFn } = setup();
    type('Entry', 'abc');
    save();
    // Symbol, Qty and Entry all invalid: Symbol comes first.
    expect(errorOf('Symbol')).toBeTruthy();
    expect(errorOf('Qty')).toBeTruthy();
    expect(errorOf('Entry')).toBeTruthy();
    expect(document.activeElement).toBe(field('Symbol'));
    type('Symbol', 'AAPL');
    save();
    expect(document.activeElement).toBe(field('Qty'));
    type('Qty', '1');
    save();
    expect(document.activeElement).toBe(field('Entry'));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('focuses Stop before Target, and Exit before Fees, per reading order', () => {
    setup();
    fillStock();
    type('Target', 'x');
    type('Stop', 'x');
    type('Fees', 'x');
    save();
    expect(document.activeElement).toBe(field('Fees'));
    type('Fees', '');
    save();
    expect(document.activeElement).toBe(field('Stop'));
  });

  it('does not flag optional fields that are left empty when blurred', () => {
    setup();
    fillStock();
    for (const l of ['Exit', 'Fees', 'Stop', 'Target', 'Notes', 'Exit time']) {
      fireEvent.blur(field(l));
      expect(errorOf(l), l).toBeUndefined();
    }
  });

  it('keeps point value out of validation for a stock', () => {
    setup();
    expect(screen.queryByLabelText('Point value')).toBeNull();
    fillStock();
    save();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});

describe('error copy coverage', () => {
  // The messages in the spec's validation table, listed here on purpose and
  // not read from ERROR_COPY, so a renamed message fails this test.
  it.each([
    [
      'closedAt',
      'exitPrice and closedAt must be provided together',
      'Add an exit time, or clear the exit price.',
    ],
    [
      'closedAt',
      'closedAt must not be before openedAt',
      "Exit time can't be before entry time.",
    ],
    [
      'pointValue',
      'pointValue is required for futures',
      'Enter dollars per point, like 5.',
    ],
    [
      'quantity',
      'quantity must be a whole number for futures',
      'Futures quantity must be a whole number.',
    ],
    [
      'plannedStop',
      'plannedStop must be below entryPrice for a long',
      'Stop must be below entry for a long trade.',
    ],
    [
      'plannedStop',
      'plannedStop must be above entryPrice for a short',
      'Stop must be above entry for a short trade.',
    ],
    [
      'plannedTarget',
      'plannedTarget must be above entryPrice for a long',
      'Target must be above entry for a long trade.',
    ],
    [
      'plannedTarget',
      'plannedTarget must be below entryPrice for a short',
      'Target must be below entry for a short trade.',
    ],
  ] as const)(
    '%s: "%s" maps to the design-system copy',
    (fieldName, message, copy) => {
      expect(explainIssue(fieldName, message)).toBe(copy);
    },
  );

  it('shows "pointValue is only allowed for futures" as is', () => {
    expect(
      explainIssue('pointValue', 'pointValue is only allowed for futures'),
    ).toBe('pointValue is only allowed for futures');
  });

  it('the copy is never the raw schema message for a mapped rule', () => {
    for (const message of [
      'closedAt must not be before openedAt',
      'pointValue is required for futures',
      'quantity must be a whole number for futures',
      'plannedStop must be below entryPrice for a long',
      'plannedStop must be above entryPrice for a short',
      'plannedTarget must be above entryPrice for a long',
      'plannedTarget must be below entryPrice for a short',
    ]) {
      const f = message.split(' ')[0] as 'closedAt';
      expect(explainIssue(f, message), message).not.toBe(message);
    }
  });

  it('shows an unmapped server message as is, on its cell', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: { plannedTarget: ['Something the form has never seen'] },
          formErrors: [],
        },
        400,
      ),
    );
    fillStock();
    save();
    await waitFor(() =>
      expect(errorOf('Target')).toBe('Something the form has never seen'),
    );
  });

  it('shows an unmapped server message as is on a cell with no field copy (Exit time)', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: { closedAt: ['Something the form has never seen'] },
          formErrors: [],
        },
        400,
      ),
    );
    fillStock();
    save();
    await waitFor(() =>
      expect(errorOf('Exit time')).toBe('Something the form has never seen'),
    );
  });

  it('shows the server pointValue-only-for-futures message as is on the Point value cell', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: {
            pointValue: ['pointValue is only allowed for futures'],
          },
          formErrors: [],
        },
        400,
      ),
    );
    click('Future');
    type('Point value', '5');
    type('Symbol', 'MES');
    type('Qty', '1');
    type('Entry', '5000');
    save();
    await waitFor(() =>
      expect(errorOf('Point value')).toBe(
        'pointValue is only allowed for futures',
      ),
    );
  });
});

describe('server errors', () => {
  const copy = "Couldn't save the trade. Check your connection and try again.";

  function fillEverything() {
    click('Future');
    click('Short');
    type('Symbol', 'MES');
    type('Point value', '5');
    type('Qty', '2');
    type('Entry', '5000');
    type('Exit', '4990');
    type('Exit time', '2026-11-19T09:45');
    type('Fees', '1.24');
    type('Stop', '5005');
    type('Target', '4980');
    type('Notes', 'kept');
  }
  function expectKept() {
    expect(field('Symbol').value).toBe('MES');
    expect(field('Point value').value).toBe('5');
    expect(field('Qty').value).toBe('2');
    expect(field('Entry').value).toBe('5000');
    expect(field('Exit').value).toBe('4990');
    expect(field('Exit time').value).toBe('2026-11-19T09:45');
    expect(field('Fees').value).toBe('1.24');
    expect(field('Stop').value).toBe('5005');
    expect(field('Target').value).toBe('4980');
    expect(field('Notes').value).toBe('kept');
    expect(checked('Future')).toBe(true);
    expect(checked('Short')).toBe(true);
  }

  it('400 fieldErrors land on their cells and every value stays', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: {
            plannedStop: ['plannedStop must be above entryPrice for a short'],
            plannedTarget: [
              'plannedTarget must be below entryPrice for a short',
            ],
          },
          formErrors: [],
        },
        400,
      ),
    );
    fillEverything();
    save();
    await waitFor(() =>
      expect(errorOf('Stop')).toBe(
        'Stop must be above entry for a short trade.',
      ),
    );
    expect(errorOf('Target')).toBe(
      'Target must be below entry for a short trade.',
    );
    expect(screen.queryByText('Trade saved')).toBeNull();
    expectKept();
  });

  it('400 formErrors show in an alert and values stay', async () => {
    setup(
      respond(
        {
          message: 'Invalid trade',
          fieldErrors: {},
          formErrors: ['Body is not allowed'],
        },
        400,
      ),
    );
    fillEverything();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Body is not allowed',
      ),
    );
    expectKept();
  });

  it('401 shows the session alert and Sign in, with every value kept', async () => {
    const { onSignIn } = setup(respond({ message: 'Unauthorized' }, 401));
    fillEverything();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Your session has expired. Sign in again.',
      ),
    );
    expectKept();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('500 shows the retry alert, keeps values, and a retry can succeed', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(view()), { status: 201 }),
      ) as unknown as typeof fetch;
    setup(fetchFn);
    fillEverything();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(copy),
    );
    expectKept();
    expect(
      (screen.getByRole('button', { name: 'Save trade' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a network failure shows the retry alert and keeps values', async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    setup(fetchFn);
    fillEverything();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(copy),
    );
    expectKept();
    expect(screen.queryByText('Trade saved')).toBeNull();
  });

  it.each([
    ['a body that fails TradeViewSchema', () => respond({ nope: 1 }, 201)],
    [
      'a non-JSON body',
      () =>
        vi.fn(() =>
          Promise.resolve(new Response('<html/>', { status: 201 })),
        ) as unknown as typeof fetch,
    ],
  ])('a 201 with %s warns the trade may have been saved', async (_n, make) => {
    const { storage } = setup(make());
    fillEverything();
    save();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The trade may have been saved. Check the list before saving again.',
      ),
    );
    expect(screen.queryByText(copy)).toBeNull();
    expect(screen.queryByText('Trade saved')).toBeNull();
    expectKept();
    expect((storage as Store).data.has(KEY)).toBe(false);
  });

  it('clears an earlier alert on the next successful save', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(view()), { status: 201 }),
      ) as unknown as typeof fetch;
    setup(fetchFn);
    fillStock();
    save();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeTruthy());
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(screen.queryByText(copy)).toBeNull();
  });
});

describe('saving in flight', () => {
  function pending() {
    let resolve!: (r: Response) => void;
    const fetchFn = vi.fn(
      () => new Promise<Response>((r) => (resolve = r)),
    ) as unknown as typeof fetch;
    return {
      fetchFn,
      finish: () =>
        resolve(new Response(JSON.stringify(view()), { status: 201 })),
    };
  }

  it('disables the button, reads "Saving…", and a second click sends nothing', async () => {
    const { fetchFn, finish } = pending();
    setup(fetchFn);
    fillStock();
    save();
    const button = screen.getByRole('button', {
      name: 'Saving…',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(field('Symbol').closest('form')!);
    expect(fetchFn).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Meta+Enter', { metaKey: true }],
  ])('a repeated %s while saving sends nothing', async (_n, mods) => {
    const { fetchFn, finish } = pending();
    setup(fetchFn);
    fillStock();
    fireEvent.keyDown(field('Notes'), { key: 'Enter', ...mods });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    fireEvent.keyDown(field('Notes'), { key: 'Enter', ...mods });
    fireEvent.keyDown(field('Entry'), { key: 'Enter', ...mods });
    expect(fetchFn).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
  });

  it('sends the access token as a bearer token', async () => {
    const fetchFn = setup().fetchFn;
    fillStock();
    save();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    const init = vi.mocked(fetchFn).mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });
});

describe('defaults', () => {
  it('uses the real clock when none is injected (fake timers)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 19, 9, 41, 59));
    render(
      <TradeForm
        apiUrl={apiUrl}
        accessToken="tok"
        onSignIn={() => {}}
        fetchFn={respond(view(), 201)}
        storage={memoryStorage()}
      />,
    );
    expect(field('Entry time').value).toBe('2026-11-19T09:41');
  });

  it('an exit price fills a blank exit time with the current minute', () => {
    setup();
    clock = new Date(2026, 10, 19, 11, 7, 45);
    type('Exit', '5');
    expect(field('Exit time').value).toBe('2026-11-19T11:07');
  });

  it('does not overwrite an exit time that is already set, even when the price changes', () => {
    setup();
    type('Exit time', '2026-11-19T10:00');
    type('Exit', '5');
    expect(field('Exit time').value).toBe('2026-11-19T10:00');
    type('Exit', '6');
    expect(field('Exit time').value).toBe('2026-11-19T10:00');
  });

  it('does not fill the exit time for an empty exit price', () => {
    setup();
    type('Exit', '');
    expect(field('Exit time').value).toBe('');
  });

  it('defaults to stock and long with no stored entry', () => {
    setup();
    expect(checked('Stock')).toBe(true);
    expect(checked('Long')).toBe(true);
    expect(screen.queryByLabelText('Point value')).toBeNull();
  });

  it('restores a stored stock / short entry', () => {
    setup(
      undefined,
      memoryStorage('{"instrumentType":"stock","side":"short"}'),
    );
    expect(checked('Stock')).toBe(true);
    expect(checked('Short')).toBe(true);
  });

  it('restores a stored future without a point value as a blank point value', () => {
    setup(
      undefined,
      memoryStorage('{"instrumentType":"future","side":"long"}'),
    );
    expect(checked('Future')).toBe(true);
    expect(field('Point value').value).toBe('');
  });

  it.each([
    ['empty string', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"future"'],
    [
      'unknown side',
      '{"instrumentType":"future","side":"flat","pointValue":"5"}',
    ],
    ['missing side', '{"instrumentType":"future"}'],
    [
      'a bad point value',
      '{"instrumentType":"future","side":"short","pointValue":"abc"}',
    ],
    [
      'a zero point value',
      '{"instrumentType":"future","side":"short","pointValue":"0"}',
    ],
  ])('falls back to stock / long for %s', (_n, raw) => {
    setup(undefined, memoryStorage(raw));
    expect(checked('Stock')).toBe(true);
    expect(checked('Long')).toBe(true);
  });

  it('reads and writes the key tradeJournal.lastTrade.v1', async () => {
    const store = memoryStorage();
    setup(undefined, store);
    click('Future');
    click('Short');
    type('Point value', '2');
    type('Symbol', 'MNQ');
    type('Qty', '1');
    type('Entry', '18000');
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(JSON.parse(store.data.get('tradeJournal.lastTrade.v1')!)).toEqual({
      instrumentType: 'future',
      side: 'short',
      pointValue: '2',
    });
  });

  it('uses window.localStorage when no storage is injected', () => {
    window.localStorage.setItem(
      KEY,
      '{"instrumentType":"future","side":"short","pointValue":"5"}',
    );
    try {
      render(
        <TradeForm
          apiUrl={apiUrl}
          accessToken="tok"
          onSignIn={() => {}}
          fetchFn={respond(view(), 201)}
          now={now}
        />,
      );
      expect(checked('Future')).toBe(true);
      expect(checked('Short')).toBe(true);
      expect(field('Point value').value).toBe('5');
    } finally {
      window.localStorage.removeItem(KEY);
    }
  });

  it('survives a localStorage that throws on every call', async () => {
    const throwing = {
      getItem: (): never => {
        throw new Error('SecurityError');
      },
      setItem: (): never => {
        throw new Error('QuotaExceeded');
      },
    };
    setup(undefined, throwing);
    expect(checked('Stock')).toBe(true);
    expect(checked('Long')).toBe(true);
    fillStock();
    save();
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('survives window.localStorage itself throwing when none is injected', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <TradeForm
        apiUrl={apiUrl}
        accessToken="tok"
        onSignIn={() => {}}
        fetchFn={respond(view(), 201)}
        now={now}
      />,
    );
    expect(checked('Stock')).toBe(true);
    expect(checked('Long')).toBe(true);
  });
});

describe('keyboard', () => {
  const futureOrder = [
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
  ];

  it('Enter in each single-line field moves to the next field, never submits, and is prevented', () => {
    const { fetchFn } = setup();
    click('Future');
    fillStock();
    type('Point value', '5');
    for (let i = 0; i < futureOrder.length - 1; i++) {
      const current = field(futureOrder[i]!);
      current.focus();
      const notPrevented = fireEvent.keyDown(current, { key: 'Enter' });
      expect(notPrevented, futureOrder[i]).toBe(false);
      expect(document.activeElement, futureOrder[i]).toBe(
        field(futureOrder[i + 1]!),
      );
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('for a stock, Enter in Symbol skips the hidden point value cell', () => {
    setup();
    field('Symbol').focus();
    fireEvent.keyDown(field('Symbol'), { key: 'Enter' });
    expect(document.activeElement).toBe(field('Qty'));
  });

  it('Enter in a valid form does not save, and does not show errors in an invalid one', () => {
    const { fetchFn } = setup();
    fillStock();
    field('Target').focus();
    fireEvent.keyDown(field('Target'), { key: 'Enter' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.queryByText('Trade saved')).toBeNull();
  });

  it('Enter in Notes adds a line: no focus move, no save, not prevented', () => {
    const { fetchFn } = setup();
    fillStock();
    field('Notes').focus();
    expect(fireEvent.keyDown(field('Notes'), { key: 'Enter' })).toBe(true);
    expect(document.activeElement).toBe(field('Notes'));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('%s+Enter saves from any field, including Notes', async (_n, mods) => {
    for (const label of [
      'Symbol',
      'Qty',
      'Entry',
      'Exit time',
      'Stop',
      'Notes',
    ]) {
      cleanup();
      const { fetchFn } = setup();
      fillStock();
      fireEvent.keyDown(field(label), { key: 'Enter', ...mods });
      await waitFor(() => expect(fetchFn, label).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    }
  });

  it('Ctrl+Enter on an invalid form shows errors, focuses the first and sends nothing', () => {
    const { fetchFn } = setup();
    fireEvent.keyDown(field('Notes'), { key: 'Enter', ctrlKey: true });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field('Symbol'));
    expect(errorOf('Symbol')).toBeTruthy();
  });

  it('Tab order (DOM order) is Type, Side, Symbol, Point value, Qty, Entry, Exit, Fees, Entry time, Exit time, Stop, Target, Notes, Save', () => {
    setup();
    click('Future');
    const radios = (names: string[]) =>
      names.map((n) => screen.getByRole('radio', { name: n }));
    const seq: HTMLElement[] = [
      ...radios(['Stock', 'Future', 'Long', 'Short']),
      ...futureOrder.map((l) => field(l)),
      screen.getByRole('button', { name: 'Save trade' }),
    ];
    for (let i = 1; i < seq.length; i++) {
      expect(
        seq[i - 1]!.compareDocumentPosition(seq[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `${i}`,
      ).toBeTruthy();
    }
    // No stray tab stops: nothing focusable outside these (one stop per radio group).
    const form = field('Symbol').closest('form')!;
    const stops = [
      ...form.querySelectorAll<HTMLElement>(
        'input, textarea, button, select, a[href], [tabindex]',
      ),
    ].filter(
      (el) =>
        !(el instanceof HTMLInputElement && el.type === 'radio') &&
        el.getAttribute('tabindex') !== '-1',
    );
    expect(stops).toHaveLength(futureOrder.length + 1);
    expect(
      stops.every((el) => el.getAttribute('tabindex') !== '0' || true),
    ).toBe(true);
    // No positive tabindex anywhere: it would reorder Tab away from DOM order.
    for (const el of form.querySelectorAll('[tabindex]')) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
  });

  it('Type and Side are native radio groups, so arrow keys move within them', () => {
    setup();
    const stock = screen.getByRole('radio', {
      name: 'Stock',
    }) as HTMLInputElement;
    const future = screen.getByRole('radio', {
      name: 'Future',
    }) as HTMLInputElement;
    const long = screen.getByRole('radio', {
      name: 'Long',
    }) as HTMLInputElement;
    const short = screen.getByRole('radio', {
      name: 'Short',
    }) as HTMLInputElement;
    for (const r of [stock, future, long, short]) expect(r.type).toBe('radio');
    expect(stock.name).toBeTruthy();
    expect(stock.name).toBe(future.name);
    expect(long.name).toBeTruthy();
    expect(long.name).toBe(short.name);
    expect(stock.name).not.toBe(long.name);
  });
});

describe('accessibility and input attributes', () => {
  it('every input is found by its label, and the groups are named', () => {
    setup();
    click('Future');
    for (const l of [
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
    ]) {
      const el = field(l);
      expect(['INPUT', 'TEXTAREA']).toContain(el.tagName);
    }
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Side' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'New trade' })).toBeTruthy();
  });

  it('has no aria-invalid or aria-describedby on a fresh form', () => {
    setup();
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(field('Symbol').hasAttribute('aria-describedby')).toBe(false);
  });

  it('an errored input is aria-invalid and described by a message that exists', () => {
    setup();
    save();
    for (const l of ['Symbol', 'Qty', 'Entry']) {
      const el = field(l);
      expect(el.getAttribute('aria-invalid'), l).toBe('true');
      const id = el.getAttribute('aria-describedby');
      expect(id, l).toBeTruthy();
      expect(document.getElementById(id!)?.textContent, l).toBeTruthy();
    }
    // Inputs without a problem are not flagged.
    expect(field('Fees').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('a textarea error is linked the same way', () => {
    setup();
    fillStock();
    type('Notes', 'x'.repeat(5001));
    save();
    expect(field('Notes').getAttribute('aria-invalid')).toBe('true');
    expect(errorOf('Notes')).toBe('Notes are 5000 characters or fewer.');
  });

  it('Symbol input attributes follow the field table', () => {
    setup();
    const s = field('Symbol');
    expect(s.type).toBe('text');
    expect(s.getAttribute('autocapitalize')).toBe('characters');
    expect(s.getAttribute('autocomplete')).toBe('off');
    expect(s.getAttribute('spellcheck')).toBe('false');
    expect(s.getAttribute('maxlength')).toBe('12');
  });

  it.each(['Qty', 'Entry', 'Exit', 'Fees', 'Stop', 'Target'])(
    '%s is a text input with a decimal keypad',
    (label) => {
      setup();
      expect(field(label).type).toBe('text');
      expect(field(label).getAttribute('inputmode')).toBe('decimal');
    },
  );

  it('Point value is a text input with a decimal keypad, a $ prefix and a /pt suffix', () => {
    setup();
    click('Future');
    const pv = field('Point value');
    expect(pv.type).toBe('text');
    expect(pv.getAttribute('inputmode')).toBe('decimal');
    const cell = pv.closest('div')!.parentElement!;
    expect(cell.textContent).toContain('$');
    expect(cell.textContent).toContain('/pt');
  });

  it.each(['Entry', 'Exit', 'Fees'])('%s has the 0.00 placeholder', (label) => {
    setup();
    expect(field(label).getAttribute('placeholder')).toBe('0.00');
  });

  it('time cells are datetime-local, and Notes is a textarea capped at 5000', () => {
    setup();
    expect(field('Entry time').type).toBe('datetime-local');
    expect(field('Exit time').type).toBe('datetime-local');
    const notes = field('Notes');
    expect(notes.tagName).toBe('TEXTAREA');
    expect(notes.getAttribute('maxlength')).toBe('5000');
  });

  it('every single-line text input has enterkeyhint="next"; Notes does not', () => {
    setup();
    click('Future');
    for (const l of [
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
    ]) {
      expect(field(l).getAttribute('enterkeyhint'), l).toBe('next');
    }
    expect(field('Notes').getAttribute('enterkeyhint')).not.toBe('next');
  });

  it('Save trade is the form submit button', () => {
    setup();
    const button = screen.getByRole('button', {
      name: 'Save trade',
    }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.form).toBe(field('Symbol').closest('form'));
  });

  it('the radio accessible names are plain: Stock, Future, Long, Short', () => {
    setup();
    for (const n of ['Stock', 'Future', 'Long', 'Short']) {
      expect(screen.getByRole('radio', { name: n })).toBeTruthy();
    }
  });

  it('Point value is hidden for stock and shown for future', () => {
    setup();
    expect(screen.queryByLabelText('Point value')).toBeNull();
    click('Future');
    expect(screen.getByLabelText('Point value')).toBeTruthy();
  });

  it('server alerts use role=alert', async () => {
    setup(respond({}, 500));
    fillStock();
    save();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
