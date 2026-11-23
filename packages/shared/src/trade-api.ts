import { z } from 'zod';
import {
  TradeFieldsSchema,
  checkTrade,
  compareInstants,
  type Trade,
} from './trade.js';
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
