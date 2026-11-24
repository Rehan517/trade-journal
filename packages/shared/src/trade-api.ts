import { z } from 'zod';
import {
  TradeFieldsSchema,
  checkTrade,
  compareInstants,
  type Trade,
} from './trade.js';
import {
  NonNegativeDecimalStringSchema,
  PositiveDecimalStringSchema,
} from './decimal.js';
import {
  grossPnl,
  initialRisk,
  netPnl,
  plannedRewardRisk,
  rMultiple,
  tradeOutcome,
} from './trade-math.js';

const IsoDateTimeSchema = z.iso.datetime();

/** `POST /trades` body. Unknown keys (including `id`) are rejected. */
export const CreateTradeRequestSchema = TradeFieldsSchema.omit({ id: true })
  .strict()
  .superRefine(checkTrade);

export type CreateTradeRequest = z.output<typeof CreateTradeRequestSchema>;
export type CreateTradeRequestInput = z.input<typeof CreateTradeRequestSchema>;

/**
 * `PATCH /trades/{id}` body: a merge patch. Every field but `id` is optional;
 * the removable ones can also be `null`. Cross-field rules run on the merged
 * trade, not here. `fees` is redeclared without its default so an absent
 * `fees` stays absent instead of resetting the stored value.
 */
export const UpdateTradeRequestSchema = TradeFieldsSchema.omit({ id: true })
  .partial()
  .extend({
    fees: NonNegativeDecimalStringSchema.optional(),
    pointValue: PositiveDecimalStringSchema.nullable().optional(),
    exitPrice: PositiveDecimalStringSchema.nullable().optional(),
    closedAt: IsoDateTimeSchema.nullable().optional(),
    plannedStop: PositiveDecimalStringSchema.nullable().optional(),
    plannedTarget: PositiveDecimalStringSchema.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'Body must change at least one field',
  });

export type UpdateTradeRequest = z.output<typeof UpdateTradeRequestSchema>;
export type UpdateTradeRequestInput = z.input<typeof UpdateTradeRequestSchema>;

/**
 * The stored trade with the patch applied and `null` keys deleted, ready for
 * `TradeSchema.safeParse`. Pure. Absent keys are left alone.
 */
export function applyTradePatch(
  trade: Trade,
  patch: UpdateTradeRequestInput,
): unknown {
  const merged: Record<string, unknown> = { ...trade };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

export const TradeMetricsSchema = z.object({
  grossPnl: z.string().optional(),
  netPnl: z.string().optional(),
  initialRisk: z.string().optional(),
  rMultiple: z.string().optional(),
  plannedRewardRisk: z.string().optional(),
  outcome: z.enum(['win', 'loss', 'breakeven']).optional(),
});
export type TradeMetrics = z.infer<typeof TradeMetricsSchema>;

export const TradeViewSchema = TradeFieldsSchema.extend({
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  metrics: TradeMetricsSchema,
}).superRefine(checkTrade);
export type TradeView = z.infer<typeof TradeViewSchema>;

export const ListTradesResponseSchema = z.object({
  items: z.array(TradeViewSchema),
  nextCursor: z.string().optional(),
});
export type ListTradesResponse = z.infer<typeof ListTradesResponseSchema>;

export const ErrorBodySchema = z.object({
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  formErrors: z.array(z.string()).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/**
 * A `from` / `to` bound. Stored keys keep 9 fractional digits, so a finer
 * bound would be cut and could let in a trade just outside it.
 */
const RangeBoundSchema = IsoDateTimeSchema.refine(
  (s) => !/\.\d{10,}Z$/.test(s),
  'Use at most 9 fractional second digits',
);

/** Query string values arrive as strings. */
export const ListTradesQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, 'limit must be a whole number')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(25),
    cursor: z.string().min(1).optional(),
    from: RangeBoundSchema.optional(),
    to: RangeBoundSchema.optional(),
  })
  .superRefine((q, ctx) => {
    // zod still runs this when a field failed, so compare only two valid
    // bounds; a bad one already has its own error. Exact, not Date.parse,
    // so sub-millisecond digits count.
    if (
      !RangeBoundSchema.safeParse(q.from).success ||
      !RangeBoundSchema.safeParse(q.to).success
    ) {
      return;
    }
    const order = compareInstants(q.from, q.to);
    if (order === 0 || order === 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be after from',
      });
    }
  });
export type ListTradesQuery = z.output<typeof ListTradesQuerySchema>;

/** Metrics for a trade, leaving out keys the maths can't compute. */
export function computeTradeMetrics(trade: Trade): TradeMetrics {
  const all = {
    grossPnl: grossPnl(trade),
    netPnl: netPnl(trade),
    initialRisk: initialRisk(trade),
    rMultiple: rMultiple(trade),
    plannedRewardRisk: plannedRewardRisk(trade),
    outcome: tradeOutcome(trade),
  };
  return Object.fromEntries(
    Object.entries(all).filter(([, v]) => v !== undefined),
  ) as TradeMetrics;
}

export function toTradeView(
  trade: Trade,
  createdAt: string,
  updatedAt: string,
): TradeView {
  return {
    ...trade,
    createdAt,
    updatedAt,
    metrics: computeTradeMetrics(trade),
  };
}
