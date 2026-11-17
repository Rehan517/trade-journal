import { describe, expect, it } from 'vitest';
import { TradeSchema } from './trade.js';

const openTrade = {
  id: '3f1c2b9e-8a4d-4c6e-9b1a-2d5e7f8a9b0c',
  symbol: ' aapl ',
  side: 'long',
  quantity: 10,
  entryPrice: 187.5,
  openedAt: '2026-11-17T09:30:00Z',
};

describe('TradeSchema', () => {
  it('parses an open trade and normalises the symbol', () => {
    const trade = TradeSchema.parse(openTrade);
    expect(trade.symbol).toBe('AAPL');
    expect(trade.exitPrice).toBeUndefined();
  });

  it('parses a closed trade', () => {
    const result = TradeSchema.safeParse({
      ...openTrade,
      exitPrice: 190,
      closedAt: '2026-11-17T15:45:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive quantity', () => {
    const result = TradeSchema.safeParse({ ...openTrade, quantity: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects an exit price without a close time', () => {
    const result = TradeSchema.safeParse({ ...openTrade, exitPrice: 190 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['closedAt']);
  });
});
