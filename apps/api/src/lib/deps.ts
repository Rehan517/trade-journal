import { DynamoTradeStore, type TradeStore } from './trade-store.js';

export type HandlerDeps = {
  store: TradeStore;
  now?: () => Date;
  newId?: () => string;
};

/** The real store. Doesn't touch AWS until the first request. */
export const defaultStore: TradeStore = new DynamoTradeStore();
