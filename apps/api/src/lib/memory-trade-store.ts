import {
  InvalidCursorError,
  inDateRange,
  openedAtKey,
  type ListKey,
  type ListResult,
  type TradeRecord,
  type TradeStore,
  tradeSk,
} from './trade-store.js';

/** In-memory `TradeStore` with the same keys and ordering as DynamoDB. */
export class MemoryTradeStore implements TradeStore {
  private readonly byUser = new Map<string, Map<string, TradeRecord>>();

  put(userId: string, record: TradeRecord): Promise<void> {
    const trades = this.byUser.get(userId) ?? new Map();
    if (trades.has(record.trade.id)) {
      return Promise.reject(new Error('The conditional request failed'));
    }
    trades.set(record.trade.id, structuredClone(record));
    this.byUser.set(userId, trades);
    return Promise.resolve();
  }

  get(userId: string, id: string): Promise<TradeRecord | undefined> {
    const found = this.byUser.get(userId)?.get(id);
    return Promise.resolve(found && structuredClone(found));
  }

  list(
    userId: string,
    options: { limit: number; startKey?: ListKey; from?: string; to?: string },
  ): Promise<ListResult> {
    const keyed = [...(this.byUser.get(userId)?.values() ?? [])]
      .map((record) => ({
        record,
        key: {
          sk: tradeSk(record.trade.id),
          openedAtKey: openedAtKey(record.trade.openedAt, record.trade.id),
        },
      }))
      .sort((a, b) => (a.key.openedAtKey < b.key.openedAtKey ? 1 : -1));

    const inRange = (key: string) => inDateRange(key, options.from, options.to);

    const { startKey } = options;
    if (startKey && !inRange(startKey.openedAtKey)) {
      return Promise.reject(
        new InvalidCursorError('cursor is outside the date range'),
      );
    }
    const ranged = keyed.filter((k) => inRange(k.key.openedAtKey));
    const rest = startKey
      ? ranged.filter((k) => k.key.openedAtKey < startKey.openedAtKey)
      : ranged;
    const page = rest.slice(0, options.limit);
    const items = page.map((k) => structuredClone(k.record));
    // Like DynamoDB, a full page reports a key even if nothing follows.
    const last = page.at(-1);
    return Promise.resolve(
      last && page.length === options.limit
        ? { items, lastKey: last.key }
        : { items },
    );
  }
}
