import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolSetting } from '@trade-journal/shared';
import { ApiError, listSymbols } from './api.ts';

/** `loading` until the first answer; `session` is a 401 (or no token). */
export type SymbolsStatus = 'loading' | 'ready' | 'error' | 'session';

/** The signed-in user's saved point values, shared by the dialog and Settings. */
export interface SymbolsState {
  /** Saved point values by contract root. Empty while loading or failed. */
  saved: ReadonlyMap<string, string>;
  status: SymbolsStatus;
  retry: () => void;
  /** A PUT succeeded: the map takes the new value. */
  applySaved: (setting: Pick<SymbolSetting, 'root' | 'pointValue'>) => void;
  /** A DELETE succeeded: the map drops the root. */
  applyRemoved: (root: string) => void;
}

/**
 * Loads `GET /symbols` once per sign-in (#10 decision 10). A token renewal
 * doesn't reload it; only a missing-then-present token or Retry does.
 * Saves and removals made while the first load is in flight are kept when
 * its answer lands.
 */
export function useSymbols(
  apiUrl: string,
  accessToken: string | undefined,
  fetchFn?: typeof fetch,
): SymbolsState {
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [state, setState] = useState<{
    attempt: number;
    status: SymbolsStatus;
  }>({ attempt: 0, status: 'loading' });
  const [retries, setRetries] = useState(0);
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  });
  const hasToken = Boolean(accessToken);
  // Changes made while a load is in flight: a value, or null for removed.
  const pending = useRef(new Map<string, string | null>());
  const loading = useRef(false);

  useEffect(() => {
    pending.current = new Map();
    const token = tokenRef.current;
    if (!hasToken || !token) {
      // Defer: state changes inside the effect body would cascade a render.
      const id = setTimeout(
        () => setState({ attempt: retries, status: 'session' }),
        0,
      );
      return () => clearTimeout(id);
    }
    loading.current = true;
    const controller = new AbortController();
    listSymbols(apiUrl, token, fetchFn, controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return;
        loading.current = false;
        const next = new Map(list.items.map((s) => [s.root, s.pointValue]));
        for (const [root, value] of pending.current) {
          if (value === null) next.delete(root);
          else next.set(root, value);
        }
        setSaved(next);
        setState({ attempt: retries, status: 'ready' });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        loading.current = false;
        setState({
          attempt: retries,
          status:
            err instanceof ApiError && err.status === 401 ? 'session' : 'error',
        });
      },
    );
    return () => {
      loading.current = false;
      controller.abort();
    };
  }, [apiUrl, hasToken, fetchFn, retries]);

  // A new attempt is loading until its own answer arrives.
  const status: SymbolsStatus =
    state.attempt === retries ? state.status : 'loading';

  const retry = useCallback(() => setRetries((n) => n + 1), []);
  const applySaved = useCallback(
    ({ root, pointValue }: Pick<SymbolSetting, 'root' | 'pointValue'>) => {
      if (loading.current) pending.current.set(root, pointValue);
      setSaved((prev) => new Map(prev).set(root, pointValue));
    },
    [],
  );
  const applyRemoved = useCallback((root: string) => {
    if (loading.current) pending.current.set(root, null);
    setSaved((prev) => {
      const next = new Map(prev);
      next.delete(root);
      return next;
    });
  }, []);

  return useMemo(
    () => ({ saved, status, retry, applySaved, applyRemoved }),
    [saved, status, retry, applySaved, applyRemoved],
  );
}
