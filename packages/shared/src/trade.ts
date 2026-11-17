import { z } from 'zod';

export const TradeSideSchema = z.enum(['long', 'short']);

export const TradeSchema = z
  .object({
    id: z.uuid(),
    symbol: z.string().trim().min(1).max(12).toUpperCase(),
    side: TradeSideSchema,
    quantity: z.number().positive(),
    entryPrice: z.number().positive(),
    exitPrice: z.number().positive().optional(),
    openedAt: z.iso.datetime(),
    closedAt: z.iso.datetime().optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((t) => (t.exitPrice === undefined) === (t.closedAt === undefined), {
    message: 'exitPrice and closedAt must be provided together',
    path: ['closedAt'],
  });

export type TradeSide = z.infer<typeof TradeSideSchema>;
export type Trade = z.infer<typeof TradeSchema>;
