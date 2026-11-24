import type { SymbolSetting } from '@trade-journal/shared';
import { byRoot, type SymbolStore } from './symbol-store.js';

/** In-memory `SymbolStore` with the same ordering as DynamoDB's. */
export class MemorySymbolStore implements SymbolStore {
  private readonly byUser = new Map<string, Map<string, SymbolSetting>>();

  list(userId: string): Promise<SymbolSetting[]> {
    const settings = [...(this.byUser.get(userId)?.values() ?? [])];
    return Promise.resolve(structuredClone(settings.sort(byRoot)));
  }

  put(userId: string, setting: SymbolSetting): Promise<void> {
    const settings = this.byUser.get(userId) ?? new Map();
    settings.set(setting.root, structuredClone(setting));
    this.byUser.set(userId, settings);
    return Promise.resolve();
  }

  delete(userId: string, root: string): Promise<boolean> {
    return Promise.resolve(this.byUser.get(userId)?.delete(root) ?? false);
  }
}
