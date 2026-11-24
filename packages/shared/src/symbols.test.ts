import { describe, expect, it } from 'vitest';
import { PositiveDecimalStringSchema } from './decimal.js';
import {
  DEFAULT_POINT_VALUES,
  PutSymbolRequestSchema,
  RootSchema,
  SymbolSettingSchema,
  contractRoot,
  pointValueFor,
} from './symbols.js';

describe('contractRoot', () => {
  it.each([
    ['MES', 'MES'],
    ['mes ', 'MES'],
    ['MESZ6', 'MES'],
    ['MESZ26', 'MES'],
    ['MESZ2026', 'MES'],
    ['MES1!', 'MES'],
    ['ES2!', 'ES'],
    ['/MES', 'MES'],
    ['/MESZ26', 'MES'],
    ['M2KH7', 'M2K'],
    ['MYMM6', 'MYM'],
    ['6EZ6', '6E'],
    ['ESZ', 'ESZ'],
    ['Z6', 'Z6'],
  ])('%s gives %s', (symbol, root) => {
    expect(contractRoot(symbol)).toBe(root);
  });
});

describe('pointValueFor', () => {
  it('prefers the saved value', () => {
    expect(pointValueFor('MES', new Map([['MES', '6']]))).toEqual({
      pointValue: '6',
      source: 'saved',
    });
  });
  it('falls back to the default', () => {
    expect(pointValueFor('NQ', new Map())).toEqual({
      pointValue: '20',
      source: 'default',
    });
  });
  it('uses a saved value for a root with no default', () => {
    expect(pointValueFor('ZN', new Map([['ZN', '1000']]))?.source).toBe(
      'saved',
    );
  });
  it('returns undefined when neither exists', () => {
    expect(pointValueFor('ZN', new Map())).toBeUndefined();
    expect(pointValueFor('constructor', new Map())).toBeUndefined();
  });
});

describe('RootSchema', () => {
  it.each(['MES', 'M2K'])('accepts %s', (v) => {
    expect(RootSchema.safeParse(v).success).toBe(true);
  });
  it.each(['MESZ6', 'MES1!', 'BRK.B', '', 'ABCDEFGHIJKLM', 'mes'])(
    'rejects %j',
    (v) => {
      expect(RootSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe('DEFAULT_POINT_VALUES', () => {
  it('has the 14 roots, each a positive decimal string and a root', () => {
    expect(Object.keys(DEFAULT_POINT_VALUES)).toHaveLength(14);
    for (const [root, value] of Object.entries(DEFAULT_POINT_VALUES)) {
      expect(PositiveDecimalStringSchema.safeParse(value).success).toBe(true);
      expect(RootSchema.safeParse(root).success).toBe(true);
    }
  });
});

describe('DEFAULT_POINT_VALUES table', () => {
  it('matches the spec table exactly', () => {
    expect(DEFAULT_POINT_VALUES).toEqual({
      ES: '50',
      MES: '5',
      NQ: '20',
      MNQ: '2',
      YM: '5',
      MYM: '0.5',
      RTY: '50',
      M2K: '5',
      CL: '1000',
      MCL: '100',
      NG: '10000',
      GC: '100',
      MGC: '10',
      SI: '5000',
    });
  });
  it('leaves out Treasury futures on purpose', () => {
    for (const root of ['ZN', 'ZB', 'ZF', 'ZT']) {
      expect(DEFAULT_POINT_VALUES).not.toHaveProperty(root);
    }
  });
  it('every default root is its own contract root', () => {
    for (const root of Object.keys(DEFAULT_POINT_VALUES)) {
      expect(contractRoot(root)).toBe(root);
    }
  });
});

describe('request and setting schemas', () => {
  it('rejects bad point values and unknown keys', () => {
    for (const body of [
      { pointValue: '-5' },
      { pointValue: '5e1' },
      { pointValue: 5 },
      { pointValue: '5', extra: 1 },
      {},
    ]) {
      expect(PutSymbolRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(
      PutSymbolRequestSchema.safeParse({ pointValue: '0.5' }).success,
    ).toBe(true);
  });
  it('parses a setting', () => {
    expect(
      SymbolSettingSchema.safeParse({
        root: 'MES',
        pointValue: '5',
        updatedAt: '2026-11-19T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
