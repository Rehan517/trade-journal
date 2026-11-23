import { z } from 'zod';
import {
  type Decimal,
  NonNegativeDecimalStringSchema,
  PositiveDecimalStringSchema,
  compareDecimal,
  parseDecimal,
} from './decimal.js';

export const TradeSideSchema = z.enum(['long', 'short']);
export const InstrumentTypeSchema = z.enum(['stock', 'future']);

/** UTC only ("Z"), seconds required, any number of fractional digits. */
const IsoDateTimeSchema = z.iso.datetime();

export const TradeFieldsSchema = z.object({
  id: z.uuid(),
  symbol: z.string().trim().min(1).max(12).toUpperCase(),
  instrumentType: InstrumentTypeSchema,
  side: TradeSideSchema,
  quantity: PositiveDecimalStringSchema,
  pointValue: PositiveDecimalStringSchema.optional(),
  entryPrice: PositiveDecimalStringSchema,
  exitPrice: PositiveDecimalStringSchema.optional(),
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.optional(),
  fees: NonNegativeDecimalStringSchema.default('0'),
  plannedStop: PositiveDecimalStringSchema.optional(),
  plannedTarget: PositiveDecimalStringSchema.optional(),
  notes: z.string().max(5000).optional(),
});

type TradeFields = z.infer<typeof TradeFieldsSchema>;

/**
 * The fields `checkTrade` reads. Typed this narrowly so it also fits schemas
 * derived from `TradeFieldsSchema`, such as one without `id`.
 */
export type CheckedTradeFields = Pick<
  TradeFields,
  'instrumentType' | 'side' | 'quantity' | 'entryPrice' | 'openedAt'
> &
  Partial<
    Pick<
      TradeFields,
      'pointValue' | 'exitPrice' | 'closedAt' | 'plannedStop' | 'plannedTarget'
    >
  >;

/*
 * Zod still runs refinements after a field fails a format check (regex,
 * datetime), though not after a wrong type. So the cross-field rules only
 * read values that passed their field's check. A field that failed already
 * has its own issue, and its rules are skipped.
 */
function validDecimal(s: unknown): Decimal | undefined {
  return PositiveDecimalStringSchema.safeParse(s).success
    ? parseDecimal(s as string)
    : undefined;
}

/**
 * Sortable key for a timestamp that passed `IsoDateTimeSchema`, with the
 * fraction padded to `digits`. Compared as strings, so sub-millisecond
 * digits count and nothing goes through `Date.parse`.
 */
function instantKey(s: string, digits: number): string {
  const [base = '', fraction = ''] = s.slice(0, -1).split('.');
  return `${base}.${fraction.padEnd(digits, '0')}`;
}

/** -1, 0 or 1, or undefined when either value isn't a valid timestamp. */
export function compareInstants(
  a: unknown,
  b: unknown,
): -1 | 0 | 1 | undefined {
  if (
    !IsoDateTimeSchema.safeParse(a).success ||
    !IsoDateTimeSchema.safeParse(b).success
  ) {
    return undefined;
  }
  const digits = Math.max((a as string).length, (b as string).length);
  const x = instantKey(a as string, digits);
  const y = instantKey(b as string, digits);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Cross-field rules. Reuse on any schema derived from `TradeFieldsSchema`. */
export function checkTrade(t: CheckedTradeFields, ctx: z.RefinementCtx): void {
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if ((t.exitPrice === undefined) !== (t.closedAt === undefined)) {
    fail('closedAt', 'exitPrice and closedAt must be provided together');
  }
  if (
    t.closedAt !== undefined &&
    compareInstants(t.closedAt, t.openedAt) === -1
  ) {
    fail('closedAt', 'closedAt must not be before openedAt');
  }

  if (t.instrumentType === 'future') {
    if (t.pointValue === undefined) {
      fail('pointValue', 'pointValue is required for futures');
    }
    const q = validDecimal(t.quantity);
    if (q && q.coefficient % 10n ** BigInt(q.scale) !== 0n) {
      fail('quantity', 'quantity must be a whole number for futures');
    }
  } else if (t.pointValue !== undefined) {
    fail('pointValue', 'pointValue is only allowed for futures');
  }

  const entry = validDecimal(t.entryPrice);
  if (entry === undefined) return;
  const long = t.side === 'long';
  const short = t.side === 'short';
  const stop = validDecimal(t.plannedStop);
  if (stop) {
    const cmp = compareDecimal(stop, entry);
    if (long && cmp >= 0) {
      fail('plannedStop', 'plannedStop must be below entryPrice for a long');
    } else if (short && cmp <= 0) {
      fail('plannedStop', 'plannedStop must be above entryPrice for a short');
    }
  }
  const target = validDecimal(t.plannedTarget);
  if (target) {
    const cmp = compareDecimal(target, entry);
    if (long && cmp <= 0) {
      fail(
        'plannedTarget',
        'plannedTarget must be above entryPrice for a long',
      );
    } else if (short && cmp >= 0) {
      fail(
        'plannedTarget',
        'plannedTarget must be below entryPrice for a short',
      );
    }
  }
}

export const TradeSchema = TradeFieldsSchema.superRefine(checkTrade);

export type TradeSide = z.infer<typeof TradeSideSchema>;
export type InstrumentType = z.infer<typeof InstrumentTypeSchema>;
/** A parsed trade. `fees` is always present. */
export type Trade = z.infer<typeof TradeSchema>;
/** What `TradeSchema` accepts, e.g. a request body. `fees` may be left out. */
export type TradeInput = z.input<typeof TradeSchema>;
