import { describe, expect, it } from 'vitest';
import { TradeFieldsSchema, TradeSchema, checkTrade } from './trade.js';
import type { TradeInput } from './trade.js';

const openTrade = {
  id: '3f1c2b9e-8a4d-4c6e-9b1a-2d5e7f8a9b0c',
  symbol: ' aapl ',
  instrumentType: 'stock',
  side: 'long',
  quantity: '10',
  entryPrice: '187.50',
  openedAt: '2026-11-17T09:30:00Z',
};

describe('TradeSchema', () => {
  it('parses an open trade, normalises the symbol and keeps prices as strings', () => {
    const trade = TradeSchema.parse(openTrade);
    expect(trade.symbol).toBe('AAPL');
    expect(trade.entryPrice).toBe('187.50');
    expect(trade.exitPrice).toBeUndefined();
  });

  it('parses a closed trade', () => {
    const result = TradeSchema.safeParse({
      ...openTrade,
      exitPrice: '190.00',
      closedAt: '2026-11-17T15:45:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fractional quantity', () => {
    const result = TradeSchema.safeParse({ ...openTrade, quantity: '0.25' });
    expect(result.success).toBe(true);
  });

  it('rejects a zero quantity', () => {
    const result = TradeSchema.safeParse({ ...openTrade, quantity: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects a price sent as a float', () => {
    const result = TradeSchema.safeParse({ ...openTrade, entryPrice: 187.5 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['entryPrice']);
  });

  it('rejects an exit price without a close time', () => {
    const result = TradeSchema.safeParse({ ...openTrade, exitPrice: '190.00' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['closedAt']);
  });
});

const future = {
  ...openTrade,
  instrumentType: 'future',
  symbol: 'MES',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
};
const closed = { exitPrice: '5010', closedAt: '2026-11-17T15:45:00Z' };

function issues(
  input: unknown,
): { path: (string | number)[]; message: string }[] {
  const r = TradeSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({
    path: i.path as (string | number)[],
    message: i.message,
  }));
}

describe('TradeSchema validation rules', () => {
  describe('exitPrice and closedAt together', () => {
    it('rejects closedAt without exitPrice', () => {
      expect(
        issues({ ...openTrade, closedAt: '2026-11-17T15:45:00Z' }),
      ).toEqual([
        {
          path: ['closedAt'],
          message: 'exitPrice and closedAt must be provided together',
        },
      ]);
    });
    it('rejects exitPrice without closedAt with the exact message', () => {
      expect(issues({ ...openTrade, exitPrice: '190.00' })).toEqual([
        {
          path: ['closedAt'],
          message: 'exitPrice and closedAt must be provided together',
        },
      ]);
    });
    it('passes with neither or both', () => {
      expect(TradeSchema.safeParse(openTrade).success).toBe(true);
      expect(
        TradeSchema.safeParse({
          ...openTrade,
          exitPrice: '190',
          closedAt: '2026-11-17T15:45:00Z',
        }).success,
      ).toBe(true);
    });
  });

  describe('closedAt not before openedAt', () => {
    it('rejects closedAt before openedAt', () => {
      expect(
        issues({
          ...openTrade,
          exitPrice: '190',
          closedAt: '2026-11-17T09:29:59Z',
        }),
      ).toEqual([
        { path: ['closedAt'], message: 'closedAt must not be before openedAt' },
      ]);
    });
    it('passes when closedAt equals openedAt', () => {
      expect(
        TradeSchema.safeParse({
          ...openTrade,
          exitPrice: '190',
          closedAt: openTrade.openedAt,
        }).success,
      ).toBe(true);
    });
    it('passes when closedAt is one second after openedAt', () => {
      expect(
        TradeSchema.safeParse({
          ...openTrade,
          exitPrice: '190',
          closedAt: '2026-11-17T09:30:01Z',
        }).success,
      ).toBe(true);
    });
    it('compares sub-millisecond digits', () => {
      const at = (openedAt: string, closedAt: string) =>
        issues({ ...openTrade, openedAt, exitPrice: '190', closedAt });
      expect(
        at('2026-11-17T09:30:00.0009Z', '2026-11-17T09:30:00.0001Z'),
      ).toEqual([
        { path: ['closedAt'], message: 'closedAt must not be before openedAt' },
      ]);
      expect(
        at('2026-11-17T09:30:00.0001Z', '2026-11-17T09:30:00.0009Z'),
      ).toEqual([]);
      expect(at('2026-11-17T09:30:00.5Z', '2026-11-17T09:30:00.50Z')).toEqual(
        [],
      );
      expect(at('2026-11-17T09:30:00.5Z', '2026-11-17T09:30:00Z')).toEqual([
        { path: ['closedAt'], message: 'closedAt must not be before openedAt' },
      ]);
    });
    it.each([
      '2026-02-30T10:00:00Z',
      '2026-11-17T09:29Z',
      '2026-11-17T09:31:00+01:00',
    ])(
      'reports only the format issue for an invalid closedAt %s',
      (closedAt) => {
        const found = issues({ ...openTrade, exitPrice: '190', closedAt });
        expect(found).toHaveLength(1);
        expect(found[0]?.path).toEqual(['closedAt']);
        expect(found[0]?.message).not.toBe(
          'closedAt must not be before openedAt',
        );
      },
    );
  });

  describe('pointValue', () => {
    it('rejects a future without pointValue', () => {
      const noPv: Record<string, unknown> = { ...future };
      delete noPv.pointValue;
      expect(issues(noPv)).toEqual([
        { path: ['pointValue'], message: 'pointValue is required for futures' },
      ]);
    });
    it('rejects a stock with pointValue', () => {
      expect(issues({ ...openTrade, pointValue: '5' })).toEqual([
        {
          path: ['pointValue'],
          message: 'pointValue is only allowed for futures',
        },
      ]);
    });
    it('passes a future with pointValue and a stock without', () => {
      expect(TradeSchema.safeParse(future).success).toBe(true);
      expect(TradeSchema.safeParse(openTrade).success).toBe(true);
    });
    it('rejects a zero pointValue on a future', () => {
      expect(
        TradeSchema.safeParse({ ...future, pointValue: '0' }).success,
      ).toBe(false);
    });
  });

  describe('future quantity must be whole', () => {
    it('rejects a fractional quantity', () => {
      expect(issues({ ...future, quantity: '1.5' })).toEqual([
        {
          path: ['quantity'],
          message: 'quantity must be a whole number for futures',
        },
      ]);
    });
    it('rejects a barely fractional quantity', () => {
      expect(issues({ ...future, quantity: '2.001' })).toEqual([
        {
          path: ['quantity'],
          message: 'quantity must be a whole number for futures',
        },
      ]);
    });
    it.each(['2.0', '2.00', '1', '10'])('passes whole quantity %s', (q) => {
      expect(TradeSchema.safeParse({ ...future, quantity: q }).success).toBe(
        true,
      );
    });
    it('still allows a fractional stock quantity', () => {
      expect(
        TradeSchema.safeParse({ ...openTrade, quantity: '0.25' }).success,
      ).toBe(true);
    });
  });

  describe('plannedStop side', () => {
    it('long: rejects a stop above entry', () => {
      expect(issues({ ...openTrade, plannedStop: '190' })).toEqual([
        {
          path: ['plannedStop'],
          message: 'plannedStop must be below entryPrice for a long',
        },
      ]);
    });
    it('long: rejects a stop equal to entry (also numerically equal)', () => {
      const msg = [
        {
          path: ['plannedStop'],
          message: 'plannedStop must be below entryPrice for a long',
        },
      ];
      expect(issues({ ...openTrade, plannedStop: '187.50' })).toEqual(msg);
      expect(issues({ ...openTrade, plannedStop: '187.5' })).toEqual(msg);
    });
    it('long: passes a stop just below entry', () => {
      expect(
        TradeSchema.safeParse({ ...openTrade, plannedStop: '187.49' }).success,
      ).toBe(true);
    });
    it('short: rejects a stop below entry', () => {
      expect(
        issues({ ...openTrade, side: 'short', plannedStop: '180' }),
      ).toEqual([
        {
          path: ['plannedStop'],
          message: 'plannedStop must be above entryPrice for a short',
        },
      ]);
    });
    it('short: rejects a stop equal to entry', () => {
      expect(
        issues({ ...openTrade, side: 'short', plannedStop: '187.5' }),
      ).toEqual([
        {
          path: ['plannedStop'],
          message: 'plannedStop must be above entryPrice for a short',
        },
      ]);
    });
    it('short: passes a stop just above entry', () => {
      expect(
        TradeSchema.safeParse({
          ...openTrade,
          side: 'short',
          plannedStop: '187.51',
        }).success,
      ).toBe(true);
    });
  });

  describe('plannedTarget side', () => {
    it('long: rejects a target below entry', () => {
      expect(issues({ ...openTrade, plannedTarget: '180' })).toEqual([
        {
          path: ['plannedTarget'],
          message: 'plannedTarget must be above entryPrice for a long',
        },
      ]);
    });
    it('long: rejects a target equal to entry', () => {
      expect(issues({ ...openTrade, plannedTarget: '187.500' })).toEqual([
        {
          path: ['plannedTarget'],
          message: 'plannedTarget must be above entryPrice for a long',
        },
      ]);
    });
    it('long: passes a target just above entry', () => {
      expect(
        TradeSchema.safeParse({ ...openTrade, plannedTarget: '187.51' })
          .success,
      ).toBe(true);
    });
    it('short: rejects a target above entry', () => {
      expect(
        issues({ ...openTrade, side: 'short', plannedTarget: '190' }),
      ).toEqual([
        {
          path: ['plannedTarget'],
          message: 'plannedTarget must be below entryPrice for a short',
        },
      ]);
    });
    it('short: rejects a target equal to entry', () => {
      expect(
        issues({ ...openTrade, side: 'short', plannedTarget: '187.5' }),
      ).toEqual([
        {
          path: ['plannedTarget'],
          message: 'plannedTarget must be below entryPrice for a short',
        },
      ]);
    });
    it('short: passes a target just below entry', () => {
      expect(
        TradeSchema.safeParse({
          ...openTrade,
          side: 'short',
          plannedTarget: '187.49',
        }).success,
      ).toBe(true);
    });
  });

  it('accepts a full closed future trade (example A)', () => {
    expect(
      TradeSchema.safeParse({
        ...future,
        ...closed,
        fees: '1.24',
        plannedStop: '4995',
        plannedTarget: '5020',
      }).success,
    ).toBe(true);
  });
});

describe('TradeSchema fees and instrumentType', () => {
  it('defaults fees to "0" when omitted', () => {
    expect(TradeSchema.parse(openTrade).fees).toBe('0');
  });
  it('keeps provided fees as given', () => {
    expect(TradeSchema.parse({ ...openTrade, fees: '1.24' }).fees).toBe('1.24');
  });
  it.each(['0', '0.00'])('accepts fees %s', (fees) => {
    expect(TradeSchema.parse({ ...openTrade, fees }).fees).toBe(fees);
  });
  it('rejects negative fees', () => {
    const r = TradeSchema.safeParse({ ...openTrade, fees: '-1' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['fees']);
  });
  it('rejects float fees', () => {
    const r = TradeSchema.safeParse({ ...openTrade, fees: 1.5 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['fees']);
  });
  it('rejects a missing or invalid instrumentType', () => {
    const rest: Record<string, unknown> = { ...openTrade };
    delete rest.instrumentType;
    expect(TradeSchema.safeParse(rest).success).toBe(false);
    expect(
      TradeSchema.safeParse({ ...openTrade, instrumentType: 'option' }).success,
    ).toBe(false);
  });
});

describe('TradeSchema never throws on malformed values reaching cross-field rules', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['quantity "abc" on a future', { ...future, quantity: 'abc' }],
    ['quantity "1e3" on a future', { ...future, quantity: '1e3' }],
    [
      'entryPrice "1e3" with a plannedStop',
      { ...openTrade, entryPrice: '1e3', plannedStop: '900' },
    ],
    [
      'entryPrice "abc" with a plannedTarget',
      { ...openTrade, entryPrice: 'abc', plannedTarget: '200' },
    ],
    ['plannedStop "-1"', { ...openTrade, plannedStop: '-1' }],
    ['plannedStop "abc"', { ...openTrade, plannedStop: 'abc' }],
    ['plannedTarget "01"', { ...openTrade, plannedTarget: '01' }],
    [
      'plannedTarget "1."',
      { ...openTrade, side: 'short', plannedTarget: '1.' },
    ],
    ['pointValue "abc"', { ...future, pointValue: 'abc' }],
    // A wrong type stops zod before checkTrade runs. These guard that
    // behaviour; the format failures above are the ones that reach the rules.
    [
      'plannedStop as a number (type abort)',
      { ...openTrade, plannedStop: 100 },
    ],
    [
      'quantity as a number on a future (type abort)',
      { ...future, quantity: 2 },
    ],
    [
      'entryPrice null with plannedStop (type abort)',
      { ...openTrade, entryPrice: null, plannedStop: '100' },
    ],
    [
      'closedAt malformed with exitPrice',
      { ...openTrade, exitPrice: '190', closedAt: 'not-a-date' },
    ],
    [
      'openedAt malformed with closedAt',
      {
        ...openTrade,
        openedAt: 'nope',
        exitPrice: '190',
        closedAt: '2026-11-17T15:45:00Z',
      },
    ],
  ];

  it.each(cases)('%s returns success:false without throwing', (_l, input) => {
    let result: ReturnType<typeof TradeSchema.safeParse> | undefined;
    expect(() => {
      result = TradeSchema.safeParse(input);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });
});

describe('checkTrade on a derived schema', () => {
  // Compiles only if checkTrade accepts a schema without `id` (spec decision 9).
  const CreateTradeSchema = TradeFieldsSchema.omit({ id: true }).superRefine(
    checkTrade,
  );
  const body: Record<string, unknown> = { ...openTrade };
  delete body.id;

  it('parses a body without id', () => {
    expect(CreateTradeSchema.safeParse(body).success).toBe(true);
  });
  it('applies the same cross-field rules', () => {
    const r = CreateTradeSchema.safeParse({ ...body, plannedStop: '200' });
    expect(r.error?.issues.map((i) => [i.path, i.message])).toEqual([
      [['plannedStop'], 'plannedStop must be below entryPrice for a long'],
    ]);
  });
});

describe('TradeInput', () => {
  it('lets fees be left out of the input type', () => {
    const input: TradeInput = {
      id: openTrade.id,
      symbol: 'AAPL',
      instrumentType: 'stock',
      side: 'long',
      quantity: '10',
      entryPrice: '187.50',
      openedAt: openTrade.openedAt,
    };
    expect(TradeSchema.parse(input).fees).toBe('0');
  });
});
