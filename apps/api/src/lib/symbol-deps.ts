import { DynamoSymbolStore, type SymbolStore } from './symbol-store.js';

export type SymbolHandlerDeps = {
  store: SymbolStore;
  now?: () => Date;
};

/** The real store. Doesn't touch AWS until the first request. */
export const defaultSymbolStore: SymbolStore = new DynamoSymbolStore();
