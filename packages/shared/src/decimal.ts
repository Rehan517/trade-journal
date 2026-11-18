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
