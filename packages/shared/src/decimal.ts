import { z } from 'zod';

/**
 * A positive decimal number carried as a string, e.g. "187.50" or "0.00012".
 * Prices and quantities use this so they never pass through a JS float.
 * Accepted form: plain digits with an optional "." fraction. No sign,
 * exponent, thousands separators or leading zeros.
 */
export const PositiveDecimalStringSchema = z
  .string()
  .max(40)
  .regex(
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
    'Must be a decimal string such as "187.50"',
  )
  .refine((s) => /[1-9]/.test(s), 'Must be greater than zero');

export type PositiveDecimalString = z.infer<typeof PositiveDecimalStringSchema>;

/** Like `PositiveDecimalStringSchema`, but zero ("0", "0.00") is allowed. */
export const NonNegativeDecimalStringSchema = z
  .string()
  .max(40)
  .regex(
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/,
    'Must be a decimal string such as "187.50"',
  );

export type NonNegativeDecimalString = z.infer<
  typeof NonNegativeDecimalStringSchema
>;

/**
 * Exact decimal arithmetic on scaled BigInts: value = coefficient / 10^scale.
 * No value ever passes through a JS number.
 */
export interface Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

/** Throws unless `n` is a usable scale or `dp`: a non-negative integer. */
function checkScale(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Scale must be a non-negative integer, got ${n}`);
  }
  return n;
}

function pow10(n: number): bigint {
  return 10n ** BigInt(checkScale(n));
}

/** Parse a signed decimal string such as "-21.62". Throws on malformed input. */
export function parseDecimal(s: string): Decimal {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Malformed decimal: ${JSON.stringify(s)}`);
  const fraction = m[3] ?? '';
  const magnitude = BigInt(`${m[2]}${fraction}`);
  return {
    coefficient: m[1] === '-' ? -magnitude : magnitude,
    scale: fraction.length,
  };
}

/** Bring both operands to the larger scale. */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(checkScale(a.scale), checkScale(b.scale));
  return [
    a.coefficient * pow10(scale - a.scale),
    b.coefficient * pow10(scale - b.scale),
    scale,
  ];
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { coefficient: x + y, scale };
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { coefficient: x - y, scale };
}

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return {
    coefficient: a.coefficient * b.coefficient,
    scale: checkScale(a.scale) + checkScale(b.scale),
  };
}

export function negateDecimal(a: Decimal): Decimal {
  return { coefficient: -a.coefficient, scale: a.scale };
}

export function absDecimal(a: Decimal): Decimal {
  return a.coefficient < 0n ? negateDecimal(a) : a;
}

/** Returns -1, 0 or 1. */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sign of the value: -1, 0 or 1. */
export function signDecimal(a: Decimal): -1 | 0 | 1 {
  return a.coefficient < 0n ? -1 : a.coefficient > 0n ? 1 : 0;
}

/**
 * a / b rounded to `dp` decimal places, half away from zero.
 * Throws when b is zero.
 */
export function divideDecimal(a: Decimal, b: Decimal, dp: number): Decimal {
  if (b.coefficient === 0n) throw new Error('Division by zero');
  const numerator = a.coefficient * pow10(dp + b.scale);
  const denominator = b.coefficient * pow10(a.scale);
  let quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  const abs = (n: bigint) => (n < 0n ? -n : n);
  if (2n * abs(remainder) >= abs(denominator)) {
    quotient += numerator < 0n !== denominator < 0n ? -1n : 1n;
  }
  return { coefficient: quotient, scale: dp };
}

/** Render with exactly `scale` fractional digits (never "-0.00"). */
function render(a: Decimal, trimZeros: boolean): string {
  const negative = a.coefficient < 0n;
  const digits = (negative ? -a.coefficient : a.coefficient)
    .toString()
    .padStart(checkScale(a.scale) + 1, '0');
  const whole = digits.slice(0, digits.length - a.scale);
  let fraction = digits.slice(digits.length - a.scale);
  if (trimZeros) fraction = fraction.replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative && /[1-9]/.test(body) ? `-${body}` : body;
}

/** Canonical string: no trailing fractional zeros, no trailing ".", never "-0". */
export function decimalToString(a: Decimal): string {
  return render(a, true);
}

/** Exactly `dp` decimal places, rounded half away from zero, never "-0.00". */
export function formatDecimalFixed(a: Decimal, dp: number): string {
  return render(divideDecimal(a, { coefficient: 1n, scale: 0 }, dp), false);
}
