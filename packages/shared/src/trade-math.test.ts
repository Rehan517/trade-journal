import { describe, expect, it } from 'vitest';
import {
  grossPnl,
  initialRisk,
  netPnl,
  rMultiple,
  tradeOutcome,
  type TradeMathInput,
  type TradeOutcome,
} from './index.js';

type Row = [
  string,
  TradeMathInput,
  string | undefined,
  string | undefined,
  string | undefined,
  string | undefined,
  TradeOutcome | undefined,
];

const rows: Row[] = [
  [
    'A',
    {
      instrumentType: 'future',
      side: 'long',
      quantity: '2',
      pointValue: '5',
      entryPrice: '5000',
      exitPrice: '5010',
      fees: '1.24',
      plannedStop: '4995',
    },
    '100',
    '98.76',
    '50',
    '1.98',
    'win',
  ],
  [
    'B',
    {
      instrumentType: 'future',
      side: 'short',
      quantity: '1',
      pointValue: '2',
      entryPrice: '18000.25',
      exitPrice: '18010.75',
      fees: '0.62',
      plannedStop: '18010.25',
    },
    '-21',
    '-21.62',
    '20',
    '-1.08',
    'loss',
  ],
  [
    'C',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '10',
      entryPrice: '187.50',
      exitPrice: '190.00',
    },
    '25',
    '25',
    undefined,
    undefined,
    'win',
  ],
  [
    'D',
    {
      instrumentType: 'stock',
      side: 'short',
      quantity: '100',
      entryPrice: '250.50',
      exitPrice: '248.25',
      fees: '2',
      plannedStop: '251.50',
    },
    '225',
    '223',
    '100',
    '2.23',
    'win',
  ],
  [
    'E',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '10',
      entryPrice: '100',
      exitPrice: '100',
    },
    '0',
    '0',
    undefined,
    undefined,
    'breakeven',
  ],
  [
    'F',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '10',
      entryPrice: '100',
      exitPrice: '100',
      fees: '1',
    },
    '0',
    '-1',
    undefined,
    undefined,
    'loss',
  ],
  [
    'G',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '0.25',
      entryPrice: '187.123',
      exitPrice: '190.456',
    },
    '0.83325',
    '0.83325',
    undefined,
    undefined,
    'win',
  ],
  [
    'H',
    {
      instrumentType: 'future',
      side: 'long',
      quantity: '2',
      pointValue: '5',
      entryPrice: '5000',
      fees: '0.62',
      plannedStop: '4995',
    },
    undefined,
    undefined,
    '50',
    undefined,
    undefined,
  ],
  [
    'I',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '100',
      entryPrice: '50',
      exitPrice: '51.005',
      plannedStop: '49',
    },
    '100.5',
    '100.5',
    '100',
    '1.01',
    'win',
  ],
  [
    'J',
    {
      instrumentType: 'stock',
      side: 'short',
      quantity: '100',
      entryPrice: '50',
      exitPrice: '51.005',
      plannedStop: '51',
    },
    '-100.5',
    '-100.5',
    '100',
    '-1.01',
    'loss',
  ],
  [
    'K',
    {
      instrumentType: 'stock',
      side: 'long',
      quantity: '1',
      entryPrice: '10',
      exitPrice: '10',
      fees: '0.004',
      plannedStop: '9',
    },
    '0',
    '-0.004',
    '1',
    '0.00',
    'loss',
  ],
];

describe('worked examples', () => {
  it.each(rows)('example %s', (_n, trade, gross, net, risk, r, outcome) => {
    expect(grossPnl(trade)).toBe(gross);
    expect(netPnl(trade)).toBe(net);
    expect(initialRisk(trade)).toBe(risk);
    expect(rMultiple(trade)).toBe(r);
    expect(tradeOutcome(trade)).toBe(outcome);
  });
});

describe('trade math edge cases', () => {
  const open: TradeMathInput = {
    instrumentType: 'stock',
    side: 'long',
    quantity: '10',
    entryPrice: '100',
    fees: '1',
    plannedStop: '95',
  };

  it('an open trade gives undefined for everything except initialRisk', () => {
    expect(grossPnl(open)).toBeUndefined();
    expect(netPnl(open)).toBeUndefined();
    expect(rMultiple(open)).toBeUndefined();
    expect(tradeOutcome(open)).toBeUndefined();
    expect(initialRisk(open)).toBe('50');
  });

  it('no plannedStop gives no R and no risk', () => {
    const t: TradeMathInput = {
      ...open,
      exitPrice: '110',
      plannedStop: undefined,
    };
    expect(initialRisk(t)).toBeUndefined();
    expect(rMultiple(t)).toBeUndefined();
    expect(netPnl(t)).toBe('99');
  });

  it('missing fees count as "0"', () => {
    const t: TradeMathInput = { ...open, exitPrice: '110', fees: undefined };
    expect(netPnl(t)).toBe('100');
    expect(netPnl(t)).toBe(grossPnl(t));
    expect(rMultiple(t)).toBe('2.00');
  });

  it('fees "0.00" give the same net as gross', () => {
    const t: TradeMathInput = { ...open, exitPrice: '110', fees: '0.00' };
    expect(netPnl(t)).toBe('100');
  });

  it('a future without pointValue throws', () => {
    const t: TradeMathInput = {
      instrumentType: 'future',
      side: 'long',
      quantity: '2',
      entryPrice: '5000',
      exitPrice: '5010',
      plannedStop: '4995',
    };
    expect(() => grossPnl(t)).toThrow();
    expect(() => netPnl(t)).toThrow();
    expect(() => initialRisk(t)).toThrow();
    expect(() => rMultiple(t)).toThrow();
  });

  it('a malformed decimal throws', () => {
    expect(() => grossPnl({ ...open, exitPrice: 'abc' })).toThrow();
  });

  it('a losing short with a loss gives a negative R', () => {
    const t: TradeMathInput = {
      ...open,
      side: 'short',
      plannedStop: '105',
      exitPrice: '102',
    };
    expect(grossPnl(t)).toBe('-20');
    expect(netPnl(t)).toBe('-21');
    expect(initialRisk(t)).toBe('50');
    expect(rMultiple(t)).toBe('-0.42');
    expect(tradeOutcome(t)).toBe('loss');
  });
});
