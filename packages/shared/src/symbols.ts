import { z } from 'zod';
import { PositiveDecimalStringSchema } from './decimal.js';

/**
 * The contract root of a symbol: `MESZ6`, `MES1!` and `/MES` are all `MES`.
 * Trims and upper-cases, then removes a leading `/`, a trailing `<digits>!`,
 * and a trailing month code with a 1, 2 or 4 digit year. If nothing is left,
 * the whole trimmed symbol is the root.
 */
export function contractRoot(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase();
  const root = trimmed
    .replace(/^\//, '')
    .replace(/\d+!$/, '')
    .replace(/[FGHJKMNQUVXZ](?:\d{4}|\d{1,2})$/, '');
  return root === '' ? trimmed : root;
}

/** A contract root as it appears in a URL: already upper-case and a root. */
export const RootSchema = z
  .string()
  .regex(/^[A-Z0-9]{1,12}$/, 'Must be 1 to 12 upper-case letters or digits')
  .refine((s) => contractRoot(s) === s, 'Must be a contract root');

/** Dollars per 1.00 point, per contract. Never stored. */
export const DEFAULT_POINT_VALUES: Readonly<Record<string, string>> =
  Object.freeze({
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

export type PointValueSource = 'saved' | 'default';

/** The user's saved value, else the default, else undefined. */
export function pointValueFor(
  root: string,
  saved: ReadonlyMap<string, string>,
): { pointValue: string; source: PointValueSource } | undefined {
  const savedValue = saved.get(root);
  if (savedValue !== undefined) {
    return { pointValue: savedValue, source: 'saved' };
  }
  if (Object.hasOwn(DEFAULT_POINT_VALUES, root)) {
    const pointValue = DEFAULT_POINT_VALUES[root];
    if (pointValue !== undefined) return { pointValue, source: 'default' };
  }
  return undefined;
}

export const SymbolSettingSchema = z.object({
  root: RootSchema,
  pointValue: PositiveDecimalStringSchema,
  updatedAt: z.iso.datetime(),
});
export type SymbolSetting = z.infer<typeof SymbolSettingSchema>;

export const ListSymbolsResponseSchema = z.object({
  items: z.array(SymbolSettingSchema),
});
export type ListSymbolsResponse = z.infer<typeof ListSymbolsResponseSchema>;

export const PutSymbolRequestSchema = z
  .object({ pointValue: PositiveDecimalStringSchema })
  .strict();
export type PutSymbolRequest = z.infer<typeof PutSymbolRequestSchema>;
