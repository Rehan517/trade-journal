import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  DEFAULT_POINT_VALUES,
  PositiveDecimalStringSchema,
  RootSchema,
  contractRoot,
} from '@trade-journal/shared';
import { ApiError, deleteSymbol, putSymbol } from './api.ts';
import { formatPointValue } from './format.ts';
import type { SymbolsState } from './useSymbols.ts';

const SYMBOL_EMPTY = 'Enter a futures symbol, like MES.';
const SYMBOL_BAD = 'Use letters and numbers only.';
const POINT_BAD = 'Enter dollars per point, like 5.';
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";
const LOAD_FAILED = "Couldn't load your saved point values.";
const SESSION_EXPIRED = 'Your session has expired. Sign in again.';

const symbolError = (text: string): string | undefined => {
  const trimmed = text.trim();
  if (trimmed === '') return SYMBOL_EMPTY;
  return RootSchema.safeParse(contractRoot(trimmed)).success
    ? undefined
    : SYMBOL_BAD;
};

const pointError = (text: string): string | undefined =>
  PositiveDecimalStringSchema.safeParse(text.trim()).success
    ? undefined
    : POINT_BAD;

interface Row {
  root: string;
  /** What the form would fill in: the saved value, else the default. */
  pointValue: string;
  source: string;
  /** Remove (saved, no default) or Use default (saved over a default). */
  action: 'remove' | 'default' | null;
}

function defaultFor(root: string): string | undefined {
  return Object.hasOwn(DEFAULT_POINT_VALUES, root)
    ? DEFAULT_POINT_VALUES[root]
    : undefined;
}

/** Every default and every saved root, sorted by root. */
function buildRows(saved: ReadonlyMap<string, string>): Row[] {
  const roots = new Set([
    ...Object.keys(DEFAULT_POINT_VALUES),
    ...saved.keys(),
  ]);
  return [...roots].sort().map((root): Row => {
    const mine = saved.get(root);
    const fallback = defaultFor(root);
    if (mine === undefined) {
      return {
        root,
        pointValue: fallback ?? '',
        source: 'Default',
        action: null,
      };
    }
    return {
      root,
      pointValue: mine,
      source:
        fallback === undefined
          ? 'Saved'
          : `Saved · default ${formatPointValue(fallback)}`,
      action: fallback === undefined ? 'remove' : 'default',
    };
  });
}

type Focus = { kind: 'edit'; root: string } | { kind: 'add' };

/** Clicking anywhere in a boxed field focuses its input. */
function focusInput(e: MouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest('input')) return;
  e.currentTarget.querySelector('input')?.focus();
}

export function SettingsPage({
  apiUrl,
  accessToken,
  onSignIn,
  fetchFn,
  symbols,
  announce,
}: {
  apiUrl: string;
  accessToken: string | undefined;
  /** Starts sign-in again, for the "session expired" alert. */
  onSignIn: () => void;
  /** Used for the API calls; replaceable in tests. */
  fetchFn?: typeof fetch;
  /** The saved point values the shell loaded once (#10 decision 10). */
  symbols: SymbolsState;
  /** Shows a toast. */
  announce: (message: string) => void;
}) {
  const { saved, status, retry, applySaved, applyRemoved } = symbols;
  const rows = buildRows(saved);

  // One save or removal at a time: a root, or 'add' for the Add form.
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [sessionLost, setSessionLost] = useState(false);
  // A failed save or removal, shown under its row.
  const [rowFailed, setRowFailed] = useState<string | null>(null);

  const [editing, setEditing] = useState<{
    root: string;
    draft: string;
    armed: boolean;
  } | null>(null);

  const [symbol, setSymbol] = useState('');
  const [point, setPoint] = useState('');
  const [armed, setArmed] = useState<{ symbol?: true; point?: true }>({});
  const [addFailed, setAddFailed] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const symbolRef = useRef<HTMLInputElement>(null);
  const pointRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<Focus | null>(null);

  // Focus lands after the render that changed the rows, so the button it
  // names exists. Inside `waitFor` for tests: it follows an await.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target.kind === 'add') {
      symbolRef.current?.focus();
    } else {
      panelRef.current
        ?.querySelector<HTMLElement>(`[data-edit="${target.root}"]`)
        ?.focus();
    }
  });

  // A new edit starts with focus in its field.
  const editRoot = editing?.root;
  useEffect(() => {
    if (!editRoot) return;
    editRef.current?.focus();
    editRef.current?.select();
  }, [editRoot]);

  // Retry removes its own button; keep keyboard users on the page.
  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (
      was === 'error' &&
      status !== 'error' &&
      (document.activeElement === document.body ||
        document.activeElement === null)
    ) {
      titleRef.current?.focus();
    }
  }, [status]);

  const loading = status === 'loading';
  const session = sessionLost || status === 'session';

  /**
   * Runs one request at a time. Resolves with its result, or undefined when
   * it didn't run or failed (a 401 shows the session alert, anything else
   * calls `onError`).
   */
  async function run<T>(
    key: string,
    request: (token: string) => Promise<T>,
    onError: () => void,
  ): Promise<{ value: T } | undefined> {
    if (pendingRef.current) return undefined;
    if (!accessToken) {
      setSessionLost(true);
      return undefined;
    }
    pendingRef.current = true;
    setPending(key);
    // Not aborted on unmount, on purpose: a save that finishes after leaving
    // Settings still updates the shared saved values (decision 10).
    try {
      return { value: await request(accessToken) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSessionLost(true);
      else onError();
      return undefined;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  const startEdit = (row: Row) => {
    if (pendingRef.current) return;
    setRowFailed(null);
    setEditing({ root: row.root, draft: row.pointValue, armed: false });
  };

  const cancelEdit = () => {
    if (!editing || pendingRef.current) return;
    focusNext.current = { kind: 'edit', root: editing.root };
    setRowFailed(null);
    setEditing(null);
  };

  const saveEdit = async () => {
    if (!editing || pendingRef.current) return;
    const { root, draft } = editing;
    if (pointError(draft)) {
      setEditing({ ...editing, armed: true });
      editRef.current?.focus();
      return;
    }
    setRowFailed(null);
    const value = draft.trim();
    const result = await run(
      root,
      (token) => putSymbol(apiUrl, token, root, value, fetchFn),
      () => setRowFailed(root),
    );
    if (!result) return;
    focusNext.current = { kind: 'edit', root };
    applySaved(result.value);
    setEditing(null);
    announce('Point value saved');
  };

  const removeRow = async (row: Row, index: number) => {
    setRowFailed(null);
    const result = await run(
      row.root,
      (token) => deleteSymbol(apiUrl, token, row.root, fetchFn),
      () => setRowFailed(row.root),
    );
    if (!result) return;
    if (row.action === 'default') {
      // The row stays, now on its default, so focus stays on its Edit button.
      focusNext.current = { kind: 'edit', root: row.root };
    } else {
      const next = rows[index + 1];
      focusNext.current = next
        ? { kind: 'edit', root: next.root }
        : { kind: 'add' };
    }
    applyRemoved(row.root);
    announce(
      row.action === 'default' ? 'Default restored' : 'Point value removed',
    );
  };

  const errors = {
    symbol: symbolError(symbol),
    point: pointError(point),
  };
  const shown = {
    symbol: armed.symbol ? errors.symbol : undefined,
    point: armed.point ? errors.point : undefined,
  };
  const addRoot =
    symbol.trim() !== '' && !errors.symbol ? contractRoot(symbol) : '';

  const keepArmed = (next: { symbol: string; point: string }) =>
    setArmed((prev) => {
      const kept: { symbol?: true; point?: true } = {};
      if (prev.symbol && symbolError(next.symbol)) kept.symbol = true;
      if (prev.point && pointError(next.point)) kept.point = true;
      return kept;
    });

  const blurAdd = (field: 'symbol' | 'point') => {
    if (errors[field] && !armed[field]) {
      setArmed((prev) => ({ ...prev, [field]: true }));
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (pendingRef.current) return;
    if (errors.symbol || errors.point) {
      setArmed({
        ...(errors.symbol ? { symbol: true as const } : {}),
        ...(errors.point ? { point: true as const } : {}),
      });
      (errors.symbol ? symbolRef : pointRef).current?.focus();
      return;
    }
    setAddFailed(false);
    const root = contractRoot(symbol);
    const value = point.trim();
    const result = await run(
      'add',
      (token) => putSymbol(apiUrl, token, root, value, fetchFn),
      () => setAddFailed(true),
    );
    if (!result) return;
    focusNext.current = { kind: 'add' };
    applySaved(result.value);
    setSymbol('');
    setPoint('');
    setArmed({});
    announce('Point value saved');
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && editing) {
      e.preventDefault();
      cancelEdit();
    }
  };

  const busy = pending !== null;

  return (
    <div className="settings">
      <h1 className="settings__title" ref={titleRef} tabIndex={-1}>
        Settings
      </h1>

      {session && (
        <div className="alert settings__alert" role="alert">
          <p>{SESSION_EXPIRED}</p>
          <button type="button" className="btn btn--ghost" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}
      {!session && status === 'error' && (
        <div className="alert settings__alert" role="alert">
          <p>{LOAD_FAILED}</p>
          <button type="button" className="btn btn--quiet" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      <section className="settings__section" aria-labelledby="settings-points">
        <div className="settings__head">
          <h2 className="settings__heading" id="settings-points">
            Point values
          </h2>
          <p className="settings__status" role="status">
            {loading ? 'Loading saved values…' : ''}
          </p>
        </div>
        <p className="settings__lede">
          Dollars per 1.00 point, per contract. Trades already logged keep their
          own value.
        </p>
        <section
          className="settings__panel"
          aria-label="Point values"
          aria-busy={loading}
          ref={panelRef}
        >
          <table className="settings__table">
            <caption className="sr-only">Point values by contract root</caption>
            <thead>
              <tr>
                <th scope="col">Root</th>
                <th scope="col" className="num">
                  Point value
                </th>
                <th scope="col" className="settings__source">
                  Source
                </th>
                <th scope="col" className="settings__actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const editingRow = editing?.root === row.root ? editing : null;
                const rowBusy = pending === row.root;
                const errorId = `settings-error-${row.root}`;
                const fieldError = editingRow?.armed
                  ? pointError(editingRow.draft)
                  : undefined;
                const failed = rowFailed === row.root;
                const note = fieldError ?? (failed ? SAVE_FAILED : undefined);
                return [
                  <tr
                    key={row.root}
                    className="settings__row"
                    data-root={row.root}
                    data-editing={editingRow ? 'true' : undefined}
                    onKeyDown={onRowKeyDown}
                  >
                    <th scope="row" className="settings__root">
                      {row.root}
                      <span className="settings__source-sub">{row.source}</span>
                    </th>
                    <td className="num settings__value">
                      {editingRow ? (
                        <div
                          className="cell__control settings__control"
                          data-invalid={fieldError ? 'true' : undefined}
                          onClick={focusInput}
                        >
                          <span className="cell__affix" aria-hidden="true">
                            $
                          </span>
                          <input
                            ref={editRef}
                            className="cell__input cell__input--mono"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`Point value for ${row.root}`}
                            value={editingRow.draft}
                            readOnly={rowBusy}
                            aria-invalid={fieldError ? 'true' : undefined}
                            aria-describedby={note ? errorId : undefined}
                            onChange={(e) =>
                              setEditing({
                                ...editingRow,
                                draft: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (
                                e.key === 'Enter' &&
                                !e.nativeEvent.isComposing
                              ) {
                                e.preventDefault();
                                void saveEdit();
                              }
                            }}
                          />
                        </div>
                      ) : (
                        formatPointValue(row.pointValue)
                      )}
                    </td>
                    <td className="settings__source">{row.source}</td>
                    <td className="settings__actions">
                      <div className="settings__buttons">
                        {editingRow ? (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              aria-disabled={rowBusy ? 'true' : undefined}
                              onClick={() => void saveEdit()}
                            >
                              {rowBusy ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="btn btn--quiet"
                              aria-disabled={rowBusy ? 'true' : undefined}
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              data-edit={row.root}
                              aria-label={`Edit ${row.root}`}
                              aria-disabled={busy ? 'true' : undefined}
                              onClick={() => startEdit(row)}
                            >
                              Edit
                            </button>
                            {row.action && (
                              <button
                                type="button"
                                className="btn btn--quiet"
                                aria-label={`${row.action === 'remove' ? 'Remove' : 'Use default for'} ${row.root}`}
                                aria-disabled={busy ? 'true' : undefined}
                                onClick={() => void removeRow(row, index)}
                              >
                                {row.action === 'remove'
                                  ? 'Remove'
                                  : 'Use default'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>,
                  note ? (
                    <tr key={`${row.root}-note`} className="settings__note-row">
                      <td colSpan={4}>
                        <p
                          className="settings__error"
                          id={errorId}
                          role={failed && !fieldError ? 'alert' : undefined}
                        >
                          {note}
                        </p>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </section>
      </section>

      <section className="settings__section" aria-labelledby="settings-add">
        <h2 className="settings__heading" id="settings-add">
          Add a symbol
        </h2>
        <form
          className="settings__add"
          noValidate
          onSubmit={(e) => void add(e)}
        >
          <div className="settings__fields">
            <div
              className="cell"
              data-invalid={shown.symbol ? 'true' : undefined}
            >
              <div className="cell__head">
                <label className="cell__label" htmlFor="settings-add-symbol">
                  Symbol
                </label>
              </div>
              <div className="cell__control" onClick={focusInput}>
                <input
                  id="settings-add-symbol"
                  ref={symbolRef}
                  className="cell__input cell__input--mono"
                  type="text"
                  value={symbol}
                  maxLength={12}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  readOnly={pending === 'add'}
                  aria-invalid={shown.symbol ? 'true' : undefined}
                  aria-describedby={
                    [
                      shown.symbol ? 'settings-add-symbol-error' : '',
                      addRoot ? 'settings-add-symbol-hint' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onChange={(e) => {
                    setSymbol(e.target.value);
                    keepArmed({ symbol: e.target.value, point });
                  }}
                  onBlur={() => blurAdd('symbol')}
                />
              </div>
              <div className="cell__foot">
                {shown.symbol && (
                  <p className="cell__error" id="settings-add-symbol-error">
                    {shown.symbol}
                  </p>
                )}
                {addRoot && (
                  <p
                    className={
                      shown.symbol ? 'cell__note sr-only' : 'cell__note'
                    }
                    id="settings-add-symbol-hint"
                  >
                    Saves as {addRoot}.
                  </p>
                )}
              </div>
            </div>
            <div
              className="cell"
              data-invalid={shown.point ? 'true' : undefined}
            >
              <div className="cell__head">
                <label className="cell__label" htmlFor="settings-add-point">
                  Point value
                </label>
              </div>
              <div className="cell__control" onClick={focusInput}>
                <span className="cell__affix" aria-hidden="true">
                  $
                </span>
                <input
                  id="settings-add-point"
                  ref={pointRef}
                  className="cell__input cell__input--mono"
                  type="text"
                  inputMode="decimal"
                  value={point}
                  autoComplete="off"
                  readOnly={pending === 'add'}
                  aria-invalid={shown.point ? 'true' : undefined}
                  aria-describedby={
                    shown.point ? 'settings-add-point-error' : undefined
                  }
                  onChange={(e) => {
                    setPoint(e.target.value);
                    keepArmed({ symbol, point: e.target.value });
                  }}
                  onBlur={() => blurAdd('point')}
                />
                <span className="cell__affix" aria-hidden="true">
                  /pt
                </span>
              </div>
              <div className="cell__foot">
                {shown.point && (
                  <p className="cell__error" id="settings-add-point-error">
                    {shown.point}
                  </p>
                )}
              </div>
            </div>
            <button
              type="submit"
              className="btn btn--ghost settings__add-button"
              aria-disabled={busy ? 'true' : undefined}
            >
              {pending === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
          {addFailed && (
            <p className="settings__error" role="alert">
              {SAVE_FAILED}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
