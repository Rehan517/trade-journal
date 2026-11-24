import { describe, expect, it } from 'vitest';
import { applyTradePatch, UpdateTradeRequestSchema } from './trade-api.js';
import { TradeSchema, type Trade } from './trade.js';

const stored: Trade = TradeSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  symbol: 'MES',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  exitPrice: '5010',
  openedAt: '2026-11-19T01:30:00Z',
  closedAt: '2026-11-19T02:00:00Z',
  fees: '1.24',
  plannedStop: '4995',
  notes: 'hello',
});

describe('UpdateTradeRequestSchema', () => {
  it('accepts a single field', () => {
    const res = UpdateTradeRequestSchema.safeParse({ plannedStop: '4990' });
    expect(res.success).toBe(true);
  });

  it('does not add fees when absent', () => {
    const res = UpdateTradeRequestSchema.parse({ notes: 'x' });
    expect(res).toEqual({ notes: 'x' });
    expect('fees' in res).toBe(false);
  });

  it.each([
    'exitPrice',
    'closedAt',
    'pointValue',
    'plannedStop',
    'plannedTarget',
    'notes',
  ])('accepts null for %s', (key) => {
    expect(UpdateTradeRequestSchema.safeParse({ [key]: null }).success).toBe(
      true,
    );
  });

  it.each([
    'symbol',
    'instrumentType',
    'side',
    'quantity',
    'entryPrice',
    'openedAt',
    'fees',
  ])('rejects null for %s', (key) => {
    expect(UpdateTradeRequestSchema.safeParse({ [key]: null }).success).toBe(
      false,
    );
  });

  it('rejects {} with the form error', () => {
    const res = UpdateTradeRequestSchema.safeParse({});
    expect(res.success).toBe(false);
    expect(res.error?.flatten().formErrors).toEqual([
      'Body must change at least one field',
    ]);
  });

  it.each(['id', 'createdAt', 'updatedAt', 'metrics', 'planedStop'])(
    'rejects unknown key %s',
    (key) => {
      const res = UpdateTradeRequestSchema.safeParse({
        notes: 'x',
        [key]: key === 'id' ? stored.id : 'x',
      });
      expect(res.success).toBe(false);
    },
  );

  it('still validates field formats', () => {
    expect(UpdateTradeRequestSchema.safeParse({ fees: '-1' }).success).toBe(
      false,
    );
  });
});

describe('applyTradePatch', () => {
  it('sets values', () => {
    expect(applyTradePatch(stored, { exitPrice: '5015' })).toEqual({
      ...stored,
      exitPrice: '5015',
    });
  });

  it('deletes null keys', () => {
    const out = applyTradePatch(stored, { exitPrice: null, closedAt: null });
    expect(out).not.toHaveProperty('exitPrice');
    expect(out).not.toHaveProperty('closedAt');
    expect(out).toMatchObject({ entryPrice: '5000', fees: '1.24' });
  });

  it('leaves absent keys alone and does not mutate the trade', () => {
    const copy = JSON.parse(JSON.stringify(stored)) as Trade;
    const out = applyTradePatch(stored, { notes: null });
    expect(out).toMatchObject({ fees: '1.24', plannedStop: '4995' });
    expect(stored).toEqual(copy);
  });
});
