import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  PositiveDecimalStringSchema,
  RootSchema,
  compareDecimal,
  contractRoot,
  parseDecimal,
  pointValueFor,
  type InstrumentType,
  type SymbolSetting,
  type TradeSide,
  type TradeView,
  type UpdateTradeRequestInput,
} from '@trade-journal/shared';
import {
  ApiError,
  INVALID_RESPONSE_STATUS,
  createTrade,
  deleteTrade,
  putSymbol,
  updateTrade,
} from './api.ts';
import {
  fieldId,
  isFieldName,
  placeIssue,
  type FieldName,
} from './errorCopy.ts';
import { formatPointValue, toLocalInputValue } from './format.ts';
import {
  readLastTrade,
  writeLastTrade,
  type LastTrade,
  type StorageLike,
} from './lastTrade.ts';
import {
  Alert,
  NotesCell,
  ResultStrip,
  SegmentedCell,
  TextCell,
} from './FormParts.tsx';
import {
  checkForm,
  computePreview,
  diffBody,
  firstInvalid,
  valuesFromTrade,
  type FieldErrors,
  type FormValues,
} from './tradeFormModel.ts';

const TYPE_OPTIONS = [
  { value: 'stock', text: 'Stock' },
  { value: 'future', text: 'Future' },
] as const satisfies readonly { value: InstrumentType; text: string }[];

const SIDE_OPTIONS = [
  { value: 'long', text: 'Long', glyph: '▲', tone: 'gain' },
  { value: 'short', text: 'Short', glyph: '▼', tone: 'loss' },
] as const satisfies readonly {
  value: TradeSide;
  text: string;
  glyph: string;
  tone: 'gain' | 'loss';
}[];

const SAVE_FAILED =
  "Couldn't save the trade. Check your connection and try again.";
const MAYBE_SAVED =
  'The trade may have been saved. Check the list before saving again.';
const MAYBE_SAVED_EDIT =
  'The changes may have been saved. Check the list before saving again.';
const SESSION_EXPIRED = 'Your session has expired. Sign in again.';
const TRADE_GONE = 'This trade has been deleted.';
const TRADE_CHANGED =
  'This trade changed while you were saving. Close it and open it again to see the latest.';
const DELETE_FAILED =
  "Couldn't delete the trade. Check your connection and try again.";

/** How the dialog was opened: a new trade, or a stored one (#9). */
export type TradeFormMode = 'new' | 'edit' | 'close';

const TITLES: Record<TradeFormMode, string> = {
  new: 'New trade',
  edit: 'Edit trade',
  close: 'Close trade',
};

type AlertState = { kind: 'session' } | { kind: 'message'; messages: string[] };

function blankValues(
  now: () => Date,
  last: LastTrade,
  openedAt?: string,
): FormValues {
  return {
    instrumentType: last.instrumentType,
    side: last.side,
    symbol: '',
    pointValue: '',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    fees: '',
    openedAt: openedAt ?? toLocalInputValue(now()),
    closedAt: '',
    plannedStop: '',
    plannedTarget: '',
    notes: '',
  };
}

/** Type and side are remembered defaults; changing them alone isn't work to lose. */
const DIRTY_FIELDS = [
  'symbol',
  'pointValue',
  'quantity',
  'entryPrice',
  'exitPrice',
  'fees',
  'openedAt',
  'closedAt',
  'plannedStop',
  'plannedTarget',
  'notes',
] as const satisfies readonly (keyof FormValues)[];

/** An edit counts every field: Type and Side are the trade's own values. */
const EDIT_DIRTY_FIELDS = [
  'instrumentType',
  'side',
  ...DIRTY_FIELDS,
] as const satisfies readonly (keyof FormValues)[];

export const TRADE_TITLE_ID = 'trade-dialog-title';

const NO_SYMBOLS: ReadonlyMap<string, string> = new Map();

/** The contract root of what's typed in Symbol, or '' when there isn't one. */
function rootOf(symbol: string): string {
  return symbol.trim() === '' ? '' : contractRoot(symbol);
}

/**
 * The hint under the point value cell (#10), or '' when there is none.
 * Only for a root the settings can hold, so it never promises a save that
 * decision 7 would skip.
 */
function pointValueHint(
  values: FormValues,
  symbols: ReadonlyMap<string, string>,
): string {
  const root = rootOf(values.symbol);
  if (!RootSchema.safeParse(root).success) return '';
  const known = pointValueFor(root, symbols);
  if (!known) return `New symbol. This value is remembered for ${root}.`;
  const typed = values.pointValue.trim();
  if (typed === '') return '';
  const same =
    PositiveDecimalStringSchema.safeParse(typed).success &&
    compareDecimal(parseDecimal(typed), parseDecimal(known.pointValue)) === 0;
  if (same) {
    return known.source === 'saved'
      ? `Saved for ${root}.`
      : `CME default for ${root}.`;
  }
  return known.source === 'saved'
    ? `Saving replaces ${formatPointValue(known.pointValue)} for ${root}.`
    : `Saving remembers this for ${root}.`;
}

/** Single-line inputs, then Notes. A radio group counts as its checked radio. */
const NAV_SELECTOR =
  'input:not([type="radio"]), textarea, input[type="radio"]:checked';

function focusNext(form: HTMLFormElement, from: Element) {
  const all = [...form.querySelectorAll<HTMLElement>(NAV_SELECTOR)];
  // An unchecked radio stands in for its group's checked one.
  const current =
    from instanceof HTMLInputElement && from.type === 'radio'
      ? (form.querySelector<HTMLElement>(
          `input[type="radio"][name="${from.name}"]:checked`,
        ) ?? from)
      : from;
  const index = all.indexOf(current as HTMLElement);
  if (index === -1) return;
  const next = all[index + 1];
  if (!next) return;
  next.focus();
  if (
    next instanceof HTMLTextAreaElement ||
    (next instanceof HTMLInputElement && next.type === 'text')
  ) {
    next.select();
  }
}

function isMac(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

export function TradeForm({
  mode = 'new',
  trade,
  apiUrl,
  accessToken,
  onSignIn,
  fetchFn,
  now = () => new Date(),
  storage,
  symbols = NO_SYMBOLS,
  onSymbolSaved,
  initialOpenedAt,
  onSaved,
  onUnchanged,
  onDeleted,
  onGone,
  onCancel,
  onDirtyChange,
  onSavingChange,
  discard,
  confirmDelete,
  onAskDelete,
}: {
  /** New trade (the default), or edit or close a stored `trade` (#9). */
  mode?: TradeFormMode;
  /** The stored trade being edited. Required for edit and close. */
  trade?: TradeView;
  apiUrl: string;
  accessToken: string | undefined;
  /** Starts sign-in again, for the "session expired" alert. */
  onSignIn: () => void;
  /** Used for the API call; replaceable in tests. */
  fetchFn?: typeof fetch;
  /** The clock; replaceable in tests. */
  now?: () => Date;
  /** Where type and side are remembered; defaults to localStorage. */
  storage?: StorageLike;
  /** The user's saved point values by contract root (#10). Defaults still apply. */
  symbols?: ReadonlyMap<string, string>;
  /** A point value was saved after a new trade; the shell updates its map. */
  onSymbolSaved?: (setting: SymbolSetting) => void;
  /** Entry time to start with, a `datetime-local` value. Now when absent. */
  initialOpenedAt?: string;
  /**
   * Called with the saved trade and the toast to show, after a 201 or a 200.
   * The parent closes the form.
   */
  onSaved: (trade: TradeView, toast: string) => void;
  /** An edit with nothing changed: the parent closes without a request. */
  onUnchanged?: () => void;
  /** The trade is gone, after a 204 or a 404. The parent closes the form. */
  onDeleted?: () => void;
  /** A save found the trade already deleted (404). */
  onGone?: () => void;
  /** Cancel and the close button. The parent decides whether to close. */
  onCancel: () => void;
  /** True once anything other than Type and Side differs from the start. */
  onDirtyChange?: (dirty: boolean) => void;
  /** True from the moment a save starts until it settles. */
  onSavingChange?: (saving: boolean) => void;
  /**
   * Set while the parent is asking "Discard this trade?". The footer then
   * shows that question instead of Save trade.
   */
  discard?: { onKeepEditing: () => void; onDiscard: () => void } | null;
  /**
   * Set while the parent is asking "Delete this trade?". The footer then
   * shows that question instead of Save changes.
   */
  confirmDelete?: { onKeep: () => void } | null;
  /** Delete trade, under Notes, was pressed. */
  onAskDelete?: () => void;
}) {
  if (mode !== 'new' && !trade) {
    throw new Error(`TradeForm needs a trade in ${mode} mode`);
  }
  const editTrade = mode === 'new' ? undefined : trade;
  const [initial] = useState(() =>
    editTrade
      ? valuesFromTrade(editTrade)
      : blankValues(now, readLastTrade(storage), initialOpenedAt),
  );
  const [values, setValues] = useState(initial);
  // Fields whose error is on show. A field joins on blur or save, if it has
  // an error then, and leaves once it's fixed.
  const [armed, setArmed] = useState<Partial<Record<FieldName, true>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A save found the trade deleted; there's nothing left to save to.
  const [gone, setGone] = useState(false);
  const [mac] = useState(isMac);
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const keepRef = useRef<HTMLButtonElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // The exit time this form filled in itself, so clearing the exit price can
  // take it back out. An exit time the trader typed or edited never matches.
  const [autoFilledExit, setAutoFilledExit] = useState<string>();
  // The point value this form filled in itself, by the same rule: a value the
  // trader typed or edited never matches, so it's never overwritten (#10).
  const [autoFilledPoint, setAutoFilledPoint] = useState<string>();
  const latest = useRef({ symbols, onSymbolSaved });
  useEffect(() => {
    latest.current = { symbols, onSymbolSaved };
  });
  const focusAlertNext = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The dialog opens with focus on Symbol. Leaving it untouched that first
  // time isn't a visit, so it doesn't show "Enter a symbol" (decision 4).
  // Typing in it, or leaving it once, ends that.
  const [symbolQuiet, setSymbolQuiet] = useState(!editTrade);
  const dirty = (editTrade ? EDIT_DIRTY_FIELDS : DIRTY_FIELDS).some(
    (f) => values[f] !== initial[f],
  );
  const callbacks = useRef({ onDirtyChange, onSavingChange });
  useEffect(() => {
    callbacks.current = { onDirtyChange, onSavingChange };
  });
  useEffect(() => {
    callbacks.current.onDirtyChange?.(dirty);
  }, [dirty]);

  // The discard question takes focus on Keep editing, and gives it back to
  // where it was when the trader keeps editing.
  const asking = Boolean(discard);
  useEffect(() => {
    if (!asking) return;
    const before = document.activeElement;
    keepRef.current?.focus();
    return () => {
      // Cancel was removed while the question showed, so focus had moved to
      // the body; give it back to the new Cancel button instead.
      if (
        before instanceof HTMLElement &&
        before.isConnected &&
        before !== document.body
      ) {
        before.focus();
      } else {
        // Read at cleanup on purpose: it's the Cancel button rendered again
        // once the question goes away.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        cancelRef.current?.focus();
      }
    };
  }, [asking]);

  // The delete question takes focus on Keep trade, and hands it back to the
  // first Delete trade button when the trader keeps the trade.
  const confirming = Boolean(confirmDelete);
  const keepTradeRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirming) return;
    keepTradeRef.current?.focus();
    return () => {
      // Read at cleanup on purpose: the button is there once the question goes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      deleteRef.current?.focus();
    };
  }, [confirming]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // After a failed save, keyboard users land on the message (or its button).
  useEffect(() => {
    if (!alert || !focusAlertNext.current) return;
    focusAlertNext.current = false;
    const button = alertRef.current?.querySelector<HTMLElement>('button');
    (button ?? alertRef.current)?.focus();
  }, [alert]);

  const check = useMemo(() => checkForm(values), [values]);
  const errors: FieldErrors = check.ok ? {} : check.errors;
  const preview = useMemo(() => computePreview(values), [values]);
  const errorFor = (field: FieldName): string | undefined =>
    serverErrors[field] ?? (armed[field] ? errors[field] : undefined);

  const future = values.instrumentType === 'future';
  const open = values.exitPrice.trim() === '' && values.closedAt === '';

  /**
   * Fills the point value from the symbol (#10 decisions 5 and 6): only in a
   * new future, only while it's empty or still what this form filled in.
   * The result is the fields to change on top of `base`.
   */
  function fillPointValue(base: FormValues): Partial<FormValues> {
    if (saving || mode !== 'new' || base.instrumentType !== 'future') return {};
    const current = base.pointValue;
    if (current.trim() !== '' && current !== autoFilledPoint) return {};
    const root = rootOf(base.symbol);
    const found = root ? pointValueFor(root, symbols) : undefined;
    setAutoFilledPoint(found?.pointValue);
    const next = found?.pointValue ?? '';
    return next === current ? {} : { pointValue: next };
  }

  function update(patch: Partial<FormValues>) {
    if (saving) return;
    const next = { ...values, ...patch };
    setValues(next);
    const result = checkForm(next);
    const nextErrors: FieldErrors = result.ok ? {} : result.errors;
    setArmed((prev) => {
      const kept: Partial<Record<FieldName, true>> = {};
      for (const f of Object.keys(prev) as FieldName[]) {
        if (nextErrors[f] !== undefined) kept[f] = true;
      }
      return kept;
    });
    setServerErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const rest = { ...prev };
      for (const f of Object.keys(patch) as FieldName[]) delete rest[f];
      return rest;
    });
  }

  // Saved values that arrive after the form opened (decision 10) refill a
  // value this form filled in from a default. Without this, the default
  // stays, and saving would log the trade at it and then PUT it over the
  // trader's saved value. A typed value is never touched (fillPointValue).
  // Adjusted during render when the prop changes, not in an effect, so there
  // is no extra render with the stale value.
  const [filledFor, setFilledFor] = useState(symbols);
  if (filledFor !== symbols) {
    setFilledFor(symbols);
    const patch = fillPointValue(values);
    if (Object.keys(patch).length > 0) update(patch);
  }

  function change(field: keyof FormValues, value: string) {
    if (field === 'symbol' && symbolQuiet) setSymbolQuiet(false);
    if (saving) return;
    const patch: Partial<FormValues> = { [field]: value };
    if (field === 'symbol') {
      Object.assign(patch, fillPointValue({ ...values, symbol: value }));
    }
    if (field === 'exitPrice') {
      if (value.trim() !== '' && values.closedAt === '') {
        // Logging just after closing is the usual case: typing an exit price
        // starts the exit time at now, unless there's already one.
        patch.closedAt = toLocalInputValue(now());
        setAutoFilledExit(patch.closedAt);
      } else if (
        value.trim() === '' &&
        autoFilledExit !== undefined &&
        values.closedAt === autoFilledExit
      ) {
        // The exit price is gone and the time is still the one we filled in.
        patch.closedAt = '';
        setAutoFilledExit(undefined);
      }
    }
    update(patch);
  }

  function blur(field: FieldName) {
    if (field === 'symbol' && symbolQuiet) {
      setSymbolQuiet(false);
      return;
    }
    if (errors[field] !== undefined && !armed[field]) {
      setArmed((prev) => ({ ...prev, [field]: true }));
    }
  }

  function focusField(field: FieldName) {
    formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`)?.focus();
  }

  async function save() {
    if (savingRef.current || gone) return;
    if (!check.ok) {
      setArmed(
        Object.fromEntries(
          Object.keys(check.errors).map((f) => [f, true]),
        ) as Partial<Record<FieldName, true>>,
      );
      const first = firstInvalid(check.errors);
      if (check.other.length > 0) {
        setAlert({ kind: 'message', messages: check.other });
        focusAlertNext.current = first === undefined;
      }
      if (first) focusField(first);
      return;
    }
    // An edit sends only what changed (decision 10); nothing changed, nothing sent.
    const patch = editTrade ? diffBody(initial, values) : undefined;
    if (patch && Object.keys(patch).length === 0) {
      onUnchanged?.();
      return;
    }
    if (!accessToken) {
      focusAlertNext.current = true;
      setAlert({ kind: 'session' });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    callbacks.current.onSavingChange?.(true);
    setAlert(null);
    setServerErrors({});
    const controller = new AbortController();
    controllerRef.current = controller;
    let saved: TradeView | undefined;
    let created: TradeView | undefined;
    let toast = 'Trade saved';
    try {
      if (editTrade && patch) {
        saved = await updateTrade(
          apiUrl,
          accessToken,
          editTrade.id,
          patch as UpdateTradeRequestInput,
          fetchFn,
          controller.signal,
        );
        const wasOpen =
          editTrade.exitPrice === undefined && editTrade.closedAt === undefined;
        toast =
          wasOpen && values.exitPrice.trim() !== ''
            ? 'Trade closed'
            : 'Changes saved';
        // An edit never touches the remembered defaults (decision 12).
      } else {
        created = await createTrade(
          apiUrl,
          accessToken,
          check.body,
          fetchFn,
          controller.signal,
        );
        const last: LastTrade = {
          instrumentType: values.instrumentType,
          side: values.side,
        };
        writeLastTrade(last, storage);
        saved = created;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      handleFailure(err);
    } finally {
      savingRef.current = false;
      callbacks.current.onSavingChange?.(false);
      if (!controller.signal.aborted) setSaving(false);
    }
    // Outside the try, so an error in the page's handler isn't reported as
    // a failed save.
    if (saved) onSaved(saved, toast);
    // After the dialog has closed, and never awaited (#10 decision 7).
    if (created) rememberPointValue(created, accessToken);
  }

  /**
   * Saves a new future's point value for its root when the user has none
   * saved for it, or a different one (#10 decision 7). A built-in default
   * doesn't count as saved: that's how an MES trader's first `5` is kept.
   * A failure shows nothing: the trade is saved, and the next trade on the
   * root asks again.
   */
  function rememberPointValue(trade: TradeView, token: string) {
    if (trade.instrumentType !== 'future' || trade.pointValue === undefined) {
      return;
    }
    const root = contractRoot(trade.symbol);
    if (!RootSchema.safeParse(root).success) return;
    const pointValue = trade.pointValue;
    // Decision 7: compared with the looked-up value, saved or default, so a
    // trade at the default writes nothing and the default keeps applying.
    const known = pointValueFor(root, latest.current.symbols)?.pointValue;
    if (
      known !== undefined &&
      compareDecimal(parseDecimal(pointValue), parseDecimal(known)) === 0
    ) {
      return;
    }
    const done = latest.current.onSymbolSaved;
    putSymbol(apiUrl, token, root, pointValue, fetchFn).then(
      (setting) => done?.(setting),
      () => {},
    );
  }

  async function remove() {
    if (savingRef.current || !editTrade) return;
    if (!accessToken) {
      focusAlertNext.current = true;
      setAlert({ kind: 'session' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setDeleting(true);
    callbacks.current.onSavingChange?.(true);
    setAlert(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    let deleted = false;
    try {
      await deleteTrade(
        apiUrl,
        accessToken,
        editTrade.id,
        fetchFn,
        controller.signal,
      );
      deleted = true;
    } catch (err) {
      if (controller.signal.aborted) return;
      focusAlertNext.current = true;
      setAlert(
        err instanceof ApiError && err.status === 401
          ? { kind: 'session' }
          : { kind: 'message', messages: [DELETE_FAILED] },
      );
    } finally {
      savingRef.current = false;
      callbacks.current.onSavingChange?.(false);
      if (!controller.signal.aborted) {
        setSaving(false);
        setDeleting(false);
      }
    }
    if (deleted) onDeleted?.();
  }

  function handleFailure(err: unknown) {
    focusAlertNext.current = true;
    if (err instanceof ApiError && err.status === 401) {
      setAlert({ kind: 'session' });
      return;
    }
    if (err instanceof ApiError && err.status === INVALID_RESPONSE_STATUS) {
      setAlert({
        kind: 'message',
        messages: [editTrade ? MAYBE_SAVED_EDIT : MAYBE_SAVED],
      });
      return;
    }
    if (editTrade && err instanceof ApiError && err.status === 404) {
      setGone(true);
      onGone?.();
      setAlert({ kind: 'message', messages: [TRADE_GONE] });
      return;
    }
    if (editTrade && err instanceof ApiError && err.status === 409) {
      setAlert({ kind: 'message', messages: [TRADE_CHANGED] });
      return;
    }
    const body =
      err instanceof ApiError && err.status === 400 ? err.body : undefined;
    if (!body) {
      setAlert({ kind: 'message', messages: [SAVE_FAILED] });
      return;
    }
    const placed: FieldErrors = {};
    const messages: string[] = [...(body.formErrors ?? [])];
    for (const [name, list] of Object.entries(body.fieldErrors ?? {})) {
      for (const message of list) {
        if (!isFieldName(name)) {
          messages.push(message);
          continue;
        }
        const at = placeIssue(name, message, values);
        // Type and side have no error slot, and the point value cell is
        // hidden for a stock: those go in the alert so nothing is swallowed.
        const shown =
          at.field !== 'instrumentType' &&
          at.field !== 'side' &&
          (at.field !== 'pointValue' || values.instrumentType === 'future');
        if (shown) placed[at.field] ??= at.text;
        else messages.push(at.text);
      }
    }
    setServerErrors(placed);
    if (messages.length === 0 && Object.keys(placed).length === 0) {
      messages.push(body.message);
    }
    setAlert(messages.length > 0 ? { kind: 'message', messages } : null);
    const first = firstInvalid(placed);
    if (first) {
      focusAlertNext.current = false;
      focusField(first);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (
      e.key !== 'Enter' ||
      e.nativeEvent.isComposing ||
      e.nativeEvent.keyCode === 229
    ) {
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (!discard && !confirmDelete) void save();
      return;
    }
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return; // adds a line
    if (target instanceof HTMLInputElement) {
      // A native form would submit here. Enter means "next" instead.
      e.preventDefault();
      focusNext(e.currentTarget, target);
    }
  }

  const cell = (field: FieldName) => ({
    field,
    value: values[field as keyof FormValues] as string,
    error: errorFor(field),
    onChange: (v: string) => change(field as keyof FormValues, v),
    onBlur: () => blur(field),
    readOnly: saving,
  });

  return (
    <form
      ref={formRef}
      className="trade-form"
      noValidate
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
    >
      <div className="dlg__header">
        <div className="dlg__heading">
          <h2 className="dlg__title" id={TRADE_TITLE_ID}>
            {TITLES[mode]}
          </h2>
          <p className="dlg__subtitle">
            Leave exit blank if the position is still open.
          </p>
        </div>
        {open && <span className="dlg__open">Open</span>}
        <button
          type="button"
          className="btn btn--icon"
          aria-label="Close"
          aria-disabled={saving ? 'true' : undefined}
          onClick={onCancel}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="dlg__body">
        <div className="fields">
          <SegmentedCell
            name="instrumentType"
            label="Type"
            value={values.instrumentType}
            options={TYPE_OPTIONS}
            onChange={(v) =>
              update({
                instrumentType: v,
                ...(v === 'future'
                  ? fillPointValue({ ...values, instrumentType: v })
                  : {}),
              })
            }
            className="cell--type"
          />
          <SegmentedCell
            name="side"
            label="Side"
            value={values.side}
            options={SIDE_OPTIONS}
            onChange={(v) => update({ side: v })}
            className="cell--side"
          />
          <TextCell
            {...cell('symbol')}
            label="Symbol"
            maxLength={12}
            symbol
            className={future ? '' : 'cell--wide'}
          />
          {future && (
            <TextCell
              {...cell('pointValue')}
              label="Point value"
              decimal
              prefix="$"
              suffix="/pt"
              hint={
                mode === 'new' ? pointValueHint(values, symbols) : undefined
              }
            />
          )}
          <TextCell {...cell('quantity')} label="Qty" decimal />
          <TextCell
            {...cell('entryPrice')}
            label="Entry"
            decimal
            placeholder="0.00"
          />
          <TextCell
            {...cell('exitPrice')}
            label="Exit"
            decimal
            placeholder="0.00"
          />
          <TextCell {...cell('fees')} label="Fees" decimal placeholder="0.00" />
          <TextCell
            {...cell('openedAt')}
            label="Entry time"
            type="datetime-local"
            className="cell--time"
          />
          <TextCell
            {...cell('closedAt')}
            label="Exit time"
            type="datetime-local"
            className="cell--time"
          />
          <TextCell
            {...cell('plannedStop')}
            label="Stop"
            decimal
            optional
            className="cell--half"
          />
          <TextCell
            {...cell('plannedTarget')}
            label="Target"
            decimal
            optional
            className="cell--half"
          />
          <NotesCell
            value={values.notes}
            readOnly={saving}
            error={errorFor('notes')}
            onChange={(v) => change('notes', v)}
            onBlur={() => blur('notes')}
          />
        </div>
        {editTrade && (
          <div className="dlg__delete">
            <button
              type="button"
              ref={deleteRef}
              className="btn btn--danger"
              aria-disabled={saving ? 'true' : undefined}
              onClick={() => {
                if (!saving) onAskDelete?.();
              }}
            >
              Delete trade
            </button>
          </div>
        )}
      </div>

      <ResultStrip preview={preview} />

      {alert && (
        <Alert alertRef={alertRef}>
          {alert.kind === 'session' ? (
            <>
              <p>{SESSION_EXPIRED}</p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onSignIn}
              >
                Sign in
              </button>
            </>
          ) : (
            alert.messages.map((m, i) => <p key={i}>{m}</p>)
          )}
        </Alert>
      )}

      <div className="dlg__footer">
        {confirmDelete ? (
          <div
            className="dlg__discard"
            role="group"
            aria-labelledby="trade-delete-question"
          >
            <p className="dlg__question" id="trade-delete-question">
              Delete this trade? This can&rsquo;t be undone.
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              ref={keepTradeRef}
              aria-disabled={saving ? 'true' : undefined}
              onClick={() => {
                if (!saving) confirmDelete.onKeep();
              }}
            >
              Keep trade
            </button>
            <button
              type="button"
              className="btn btn--danger"
              aria-disabled={saving ? 'true' : undefined}
              onClick={() => void remove()}
            >
              {deleting ? 'Deleting…' : 'Delete trade'}
            </button>
          </div>
        ) : discard ? (
          <div
            className="dlg__discard"
            role="group"
            aria-labelledby="trade-discard-question"
          >
            <p className="dlg__question" id="trade-discard-question">
              {editTrade ? 'Discard changes?' : 'Discard this trade?'}
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              ref={keepRef}
              onClick={discard.onKeepEditing}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={discard.onDiscard}
            >
              Discard
            </button>
          </div>
        ) : (
          <>
            <span className="dlg__shortcut">
              {mac ? '⌘ Enter' : 'Ctrl+Enter'} to save · Esc to close
            </span>
            <button
              type="button"
              ref={cancelRef}
              className="btn btn--ghost"
              aria-disabled={saving ? 'true' : undefined}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={gone}
              aria-disabled={saving || gone ? 'true' : undefined}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {saving ? 'Saving…' : editTrade ? 'Save changes' : 'Save trade'}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
