import { InstrumentTypeSchema, TradeSideSchema } from '@trade-journal/shared';
import { z } from 'zod';

export const LAST_TRADE_KEY = 'tradeJournal.lastTrade.v1';

/**
 * Type and side. An old entry may still carry a `pointValue`: it parses and
 * is dropped, because point values are per symbol now (#10 decision 11).
 */
export const LastTradeSchema = z.object({
  instrumentType: InstrumentTypeSchema,
  side: TradeSideSchema,
});
export type LastTrade = z.infer<typeof LastTradeSchema>;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const DEFAULT_LAST_TRADE: LastTrade = {
  instrumentType: 'stock',
  side: 'long',
};

/** `window.localStorage` can throw on access (private browsing, blocked). */
function resolve(storage?: StorageLike): StorageLike | undefined {
  try {
    return storage ?? window.localStorage;
  } catch {
    return undefined;
  }
}

/** Remembered type and side; stock / long when missing or bad. */
export function readLastTrade(storage?: StorageLike): LastTrade {
  try {
    const raw = resolve(storage)?.getItem(LAST_TRADE_KEY);
    if (raw == null) return DEFAULT_LAST_TRADE;
    const parsed = LastTradeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_LAST_TRADE;
  } catch {
    return DEFAULT_LAST_TRADE;
  }
}

/** Best effort: a full or unavailable store never breaks saving. */
export function writeLastTrade(last: LastTrade, storage?: StorageLike): void {
  try {
    resolve(storage)?.setItem(LAST_TRADE_KEY, JSON.stringify(last));
  } catch {
    // Remembering is a convenience, not part of the save.
  }
}
