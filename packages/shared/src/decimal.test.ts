import { describe, expect, it } from 'vitest';
import { PositiveDecimalStringSchema } from './decimal.js';

describe('PositiveDecimalStringSchema', () => {
  it.each(['1', '187.50', '0.00012', '10.0', '123456789.123456789'])(
    'accepts %s',
    (value) => {
      expect(PositiveDecimalStringSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    ['zero', '0'],
    ['zero with fraction', '0.000'],
    ['negative', '-1.5'],
    ['explicit plus sign', '+1.5'],
    ['leading zero', '007'],
    ['exponent', '1e3'],
    ['thousands separator', '1,000'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['whitespace', ' 1.5'],
    ['empty', ''],
    ['too long', '1'.repeat(41)],
  ])('rejects %s', (_label, value) => {
    expect(PositiveDecimalStringSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a number, even a valid one', () => {
    expect(PositiveDecimalStringSchema.safeParse(187.5).success).toBe(false);
  });
});
