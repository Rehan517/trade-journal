import { describe, expect, it } from 'vitest';
import {
  NonNegativeDecimalStringSchema,
  PositiveDecimalStringSchema,
  absDecimal,
  addDecimal,
  compareDecimal,
  decimalToString,
  divideDecimal,
  formatDecimalFixed,
  multiplyDecimal,
  negateDecimal,
  parseDecimal,
  signDecimal,
  subtractDecimal,
} from './decimal.js';

const d = parseDecimal;

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

describe('NonNegativeDecimalStringSchema', () => {
  it.each(['0', '0.00', '0.004', '1', '187.50', '10.0'])('accepts %s', (v) => {
    expect(NonNegativeDecimalStringSchema.parse(v)).toBe(v);
  });

  it.each([
    ['negative', '-1'],
    ['negative zero', '-0'],
    ['plus sign', '+1'],
    ['leading zero', '007'],
    ['exponent', '1e3'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['whitespace', ' 1'],
    ['empty', ''],
    ['too long', '1'.repeat(41)],
  ])('rejects %s', (_l, v) => {
    expect(NonNegativeDecimalStringSchema.safeParse(v).success).toBe(false);
  });

  it('rejects a number', () => {
    expect(NonNegativeDecimalStringSchema.safeParse(0).success).toBe(false);
    expect(NonNegativeDecimalStringSchema.safeParse(1.5).success).toBe(false);
  });
});

describe('parseDecimal', () => {
  it.each([
    ['5000.25', '5000.25'],
    ['-1.5', '-1.5'],
    ['0', '0'],
    ['10.0', '10'],
    ['-0.004', '-0.004'],
  ])('parses %s', (input, expected) => {
    expect(decimalToString(d(input))).toBe(expected);
  });

  it.each(['abc', '', '1e3', '1.', '.5', '1.2.3', ' 1', '--1', '1,000'])(
    'throws on malformed %j',
    (v) => {
      expect(() => parseDecimal(v)).toThrow();
    },
  );
});

describe('decimal arithmetic', () => {
  it.each([
    ['1.5', '2.25', '3.75'],
    ['0.1', '0.2', '0.3'],
    ['100', '0.001', '100.001'],
    ['-1.5', '0.5', '-1'],
    ['-1', '-2.5', '-3.5'],
    ['1.50', '-1.5', '0'],
  ])('add %s + %s = %s', (a, b, expected) => {
    expect(decimalToString(addDecimal(d(a), d(b)))).toBe(expected);
  });

  it.each([
    ['5010', '5000', '10'],
    ['1', '2.5', '-1.5'],
    ['0.3', '0.1', '0.2'],
    ['18010.75', '18000.25', '10.5'],
    ['-1', '-1', '0'],
    ['0', '0.004', '-0.004'],
  ])('subtract %s - %s = %s', (a, b, expected) => {
    expect(decimalToString(subtractDecimal(d(a), d(b)))).toBe(expected);
  });

  it.each([
    ['0.25', '3.333', '0.83325'],
    ['2', '5', '10'],
    ['-2', '5', '-10'],
    ['-2', '-5', '10'],
    ['1.5', '0', '0'],
    ['-1.5', '0', '0'],
    ['0.1', '0.1', '0.01'],
    ['10.0', '2.50', '25'],
  ])('multiply %s x %s = %s', (a, b, expected) => {
    expect(decimalToString(multiplyDecimal(d(a), d(b)))).toBe(expected);
  });

  it.each([
    ['1', '2', -1],
    ['2', '1', 1],
    ['1.0', '1.00', 0],
    ['1.10', '1.1', 0],
    ['0.999', '1', -1],
    ['-1', '1', -1],
    ['-2', '-1', -1],
    ['-1', '-1.0', 0],
    ['100.001', '100', 1],
    ['0', '-0', 0],
  ])('compare %s vs %s = %i', (a, b, expected) => {
    expect(compareDecimal(d(a), d(b))).toBe(expected);
  });

  it('signDecimal, negateDecimal and absDecimal', () => {
    expect(signDecimal(d('2.5'))).toBe(1);
    expect(signDecimal(d('-2.5'))).toBe(-1);
    expect(signDecimal(d('0.00'))).toBe(0);
    expect(decimalToString(negateDecimal(d('2.5')))).toBe('-2.5');
    expect(decimalToString(negateDecimal(d('-2.5')))).toBe('2.5');
    expect(decimalToString(negateDecimal(d('0')))).toBe('0');
    expect(decimalToString(absDecimal(d('-2.50')))).toBe('2.5');
    expect(decimalToString(absDecimal(d('2.5')))).toBe('2.5');
  });
});

describe('decimalToString canonical form', () => {
  it.each([
    ['1.500', '1.5'],
    ['10.0', '10'],
    ['100', '100'],
    ['0.00', '0'],
    ['0', '0'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['-2.50', '-2.5'],
    ['0.83325', '0.83325'],
    ['-0.004', '-0.004'],
  ])('%s -> %s', (input, expected) => {
    expect(decimalToString(d(input))).toBe(expected);
  });

  it('never returns "-0" or a trailing dot for computed results', () => {
    const results = [
      subtractDecimal(d('1.5'), d('1.5')),
      multiplyDecimal(d('-3'), d('0')),
      addDecimal(d('-0.5'), d('0.50')),
      negateDecimal(d('0.0')),
    ].map(decimalToString);
    for (const r of results) {
      expect(r).toBe('0');
    }
    expect(decimalToString(addDecimal(d('1.5'), d('1.5')))).toBe('3');
  });
});

describe('divideDecimal', () => {
  const div = (a: string, b: string, dp: number) =>
    formatDecimalFixed(divideDecimal(d(a), d(b), dp), dp);

  it.each([
    ['98.76', '50', 2, '1.98'],
    ['1', '3', 2, '0.33'],
    ['2', '3', 2, '0.67'],
    ['10', '4', 2, '2.50'],
    ['100', '50', 2, '2.00'],
    ['-21.62', '20', 2, '-1.08'],
    ['223', '100', 2, '2.23'],
    ['0', '7', 2, '0.00'],
  ])('%s / %s at %i dp = %s', (a, b, dp, expected) => {
    expect(div(a, b, dp)).toBe(expected);
  });

  it.each([
    ['1.005', '1', 2, '1.01'],
    ['-1.005', '1', 2, '-1.01'],
    ['1.004', '1', 2, '1.00'],
    ['-1.004', '1', 2, '-1.00'],
    ['0.125', '1', 2, '0.13'],
    ['2.5', '1', 0, '3'],
    ['-2.5', '1', 0, '-3'],
    ['3.5', '1', 0, '4'],
    ['1', '8', 2, '0.13'],
    ['-1', '8', 2, '-0.13'],
    ['100.5', '100', 2, '1.01'],
    ['-100.5', '100', 2, '-1.01'],
    ['100.5', '-100', 2, '-1.01'],
    ['-100.5', '-100', 2, '1.01'],
  ])(
    'rounds half away from zero: %s / %s at %i dp = %s',
    (a, b, dp, expected) => {
      expect(div(a, b, dp)).toBe(expected);
    },
  );

  it('a value that rounds to zero is "0.00", never "-0.00"', () => {
    expect(div('-0.004', '1', 2)).toBe('0.00');
    expect(div('0.004', '1', 2)).toBe('0.00');
    expect(div('-1', '1000', 2)).toBe('0.00');
  });

  it('throws on division by zero', () => {
    expect(() => divideDecimal(d('1'), d('0'), 2)).toThrow();
    expect(() => divideDecimal(d('1'), d('0.00'), 2)).toThrow();
    expect(() => divideDecimal(d('0'), d('0'), 2)).toThrow();
  });
});

describe('formatDecimalFixed', () => {
  it.each([
    ['1.5', 2, '1.50'],
    ['2', 2, '2.00'],
    ['0', 2, '0.00'],
    ['-1.08', 2, '-1.08'],
    ['10.0', 1, '10.0'],
    ['7', 0, '7'],
  ])('%s at %i dp = %s', (input, dp, expected) => {
    expect(formatDecimalFixed(d(input), dp)).toBe(expected);
  });

  it('never returns "-0.00"', () => {
    expect(formatDecimalFixed(d('-0'), 2)).toBe('0.00');
    expect(formatDecimalFixed(d('-0.000'), 2)).toBe('0.00');
    expect(formatDecimalFixed(negateDecimal(d('0')), 2)).toBe('0.00');
    expect(formatDecimalFixed(subtractDecimal(d('1'), d('1')), 2)).toBe('0.00');
  });
});

describe('scale and dp guard', () => {
  it.each([-1, 1.5, Number.NaN])('rejects dp %s', (dp) => {
    expect(() =>
      divideDecimal(parseDecimal('1'), parseDecimal('3'), dp),
    ).toThrow(/non-negative integer/);
    expect(() => formatDecimalFixed(parseDecimal('1'), dp)).toThrow(
      /non-negative integer/,
    );
  });
  it('rejects a hand-built Decimal with a negative scale', () => {
    expect(() =>
      addDecimal({ coefficient: 1n, scale: -1 }, parseDecimal('1')),
    ).toThrow(/non-negative integer/);
  });
});
