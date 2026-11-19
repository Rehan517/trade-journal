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
  type InstrumentType,
  type TradeSide,
} from '@trade-journal/shared';
import { ApiError, INVALID_RESPONSE_STATUS, createTrade } from './api.ts';
import {
  fieldId,
  isFieldName,
  placeIssue,
  type FieldName,
} from './errorCopy.ts';
import { formatShortDate, toLocalInputValue } from './format.ts';
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
  Toast,
} from './FormParts.tsx';
import {
  checkForm,
  computePreview,
  firstInvalid,
  type FieldErrors,
  type FormValues,
} from './tradeFormModel.ts';

const TYPE_OPTIONS = [
  { value: 'stock', text: 'Stock' },
  { value: 'future', text: 'Future' },
] as const satisfies readonly { value: InstrumentType; text: string }[];

const SIDE_OPTIONS = [
  { value: 'long', text: 'Long', glyph: '▲' },
  { value: 'short', text: 'Short', glyph: '▼' },
] as const satisfies readonly {
  value: TradeSide;
  text: string;
  glyph: string;
}[];

const SAVE_FAILED =
  "Couldn't save the trade. Check your connection and try again.";
const MAYBE_SAVED =
  'The trade may have been saved. Check the list before saving again.';
const SESSION_EXPIRED = 'Your session has expired. Sign in again.';

type AlertState = { kind: 'session' } | { kind: 'message'; messages: string[] };

function blankValues(now: () => Date, last: LastTrade): FormValues {
  return {
    instrumentType: last.instrumentType,
    side: last.side,
    symbol: '',
    pointValue: last.pointValue ?? '',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    fees: '',
    openedAt: toLocalInputValue(now()),
    closedAt: '',
    plannedStop: '',
    plannedTarget: '',
    notes: '',
  };
}

/** Single-line inputs, then Notes. A radio group counts as its checked radio. */
const NAV_SELECTOR =
  'input:not([type="radio"]), textarea, input[type="radio"]:checked';

function focusNext(form: HTMLFormElement, from: Element) {
  const all = [...form.querySelectorAll<HTMLElement>(NAV_SELECTOR)];
  const next = all[all.indexOf(from as HTMLElement) + 1];
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
  apiUrl,
  accessToken,
  onSignIn,
  fetchFn,
  now = () => new Date(),
  storage,
}: {
  apiUrl: string;
  accessToken: string | undefined;
  /** Starts sign-in again, for the "session expired" alert. */
  onSignIn: () => void;
  /** Used for the API call; replaceable in tests. */
  fetchFn?: typeof fetch;
  /** The clock; replaceable in tests. */
  now?: () => Date;
  /** Where type, side and point value are remembered; defaults to localStorage. */
  storage?: StorageLike;
}) {
  const [values, setValues] = useState(() =>
    blankValues(now, readLastTrade(storage)),
  );
  const [currentYear] = useState(() => now().getFullYear());
  // Fields whose error is on show. A field joins on blur or save, if it has
  // an error then, and leaves once it's fixed.
  const [armed, setArmed] = useState<Partial<Record<FieldName, true>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const [mac] = useState(isMac);
  const formRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const toastId = useRef(0);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const check = useMemo(() => checkForm(values), [values]);
  const errors: FieldErrors = check.ok ? {} : check.errors;
  const preview = useMemo(() => computePreview(values), [values]);
  const errorFor = (field: FieldName): string | undefined =>
    serverErrors[field] ?? (armed[field] ? errors[field] : undefined);

  const future = values.instrumentType === 'future';
  const open = values.exitPrice.trim() === '' && values.closedAt === '';

  function update(patch: Partial<FormValues>) {
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

  function change(field: keyof FormValues, value: string) {
    const patch: Partial<FormValues> = { [field]: value };
    // Logging just after closing is the usual case: typing an exit price
    // starts the exit time at now, unless there's already one.
    if (
      field === 'exitPrice' &&
      value.trim() !== '' &&
      values.closedAt === ''
    ) {
      patch.closedAt = toLocalInputValue(now());
    }
    update(patch);
  }

  function blur(field: FieldName) {
    if (errors[field] !== undefined && !armed[field]) {
      setArmed((prev) => ({ ...prev, [field]: true }));
    }
  }

  function focusField(field: FieldName) {
    formRef.current?.querySelector<HTMLElement>(`#${fieldId(field)}`)?.focus();
  }

  async function save() {
    if (savingRef.current) return;
    if (!check.ok) {
      setArmed(
        Object.fromEntries(
          Object.keys(check.errors).map((f) => [f, true]),
        ) as Partial<Record<FieldName, true>>,
      );
      const first = firstInvalid(check.errors);
      if (first) focusField(first);
      return;
    }
    if (!accessToken) {
      setAlert({ kind: 'session' });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setAlert(null);
    setServerErrors({});
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await createTrade(
        apiUrl,
        accessToken,
        check.body,
        fetchFn,
        controller.signal,
      );
      const pointValue = values.pointValue.trim();
      const last: LastTrade = {
        instrumentType: values.instrumentType,
        side: values.side,
        ...(PositiveDecimalStringSchema.safeParse(pointValue).success
          ? { pointValue }
          : {}),
      };
      writeLastTrade(last, storage);
      toastId.current += 1;
      setToast({ id: toastId.current, message: 'Trade saved' });
      setValues(blankValues(now, last));
      setArmed({});
      focusField('symbol');
    } catch (err) {
      if (controller.signal.aborted) return;
      handleFailure(err);
    } finally {
      savingRef.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  function handleFailure(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      setAlert({ kind: 'session' });
      return;
    }
    if (err instanceof ApiError && err.status === INVALID_RESPONSE_STATUS) {
      setAlert({ kind: 'message', messages: [MAYBE_SAVED] });
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
        placed[at.field] ??= at.text;
      }
    }
    setServerErrors(placed);
    if (messages.length === 0 && Object.keys(placed).length === 0) {
      messages.push(body.message);
    }
    setAlert(messages.length > 0 ? { kind: 'message', messages } : null);
    const first = firstInvalid(placed);
    if (first) focusField(first);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void save();
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
  });

  return (
    <form
      ref={formRef}
      className="trade-form"
      noValidate
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
    >
      <div className="ticket">
        <div className="ticket__header">
          <h1 className="ticket__title">New trade</h1>
          {open ? (
            <span className="ticket__meta ticket__meta--open">Open</span>
          ) : (
            <span className="ticket__meta">
              {formatShortDate(values.openedAt, currentYear)}
            </span>
          )}
        </div>

        <div className="ticket__grid">
          <SegmentedCell
            name="instrumentType"
            label="Type"
            value={values.instrumentType}
            options={TYPE_OPTIONS}
            onChange={(v) => update({ instrumentType: v })}
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
            className={future ? '' : 'cell--span-sm'}
          />
          {future ? (
            <TextCell
              {...cell('pointValue')}
              label="Point value"
              decimal
              prefix="$"
              suffix="/pt"
            />
          ) : (
            <div className="cell cell--spacer" aria-hidden="true" />
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
          <TextCell {...cell('plannedStop')} label="Stop" decimal />
          <TextCell {...cell('plannedTarget')} label="Target" decimal />
          <div className="cell cell--filler" aria-hidden="true" />
          <NotesCell
            value={values.notes}
            error={errorFor('notes')}
            onChange={(v) => change('notes', v)}
            onBlur={() => blur('notes')}
          />
        </div>

        <ResultStrip preview={preview} />
      </div>

      {alert && (
        <Alert>
          {alert.kind === 'session' ? (
            <>
              <p>{SESSION_EXPIRED}</p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onSignIn}
              >
                Sign in
              </button>
            </>
          ) : (
            alert.messages.map((m) => <p key={m}>{m}</p>)
          )}
        </Alert>
      )}

      <div className="actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {saving ? 'Saving…' : 'Save trade'}
        </button>
        <span className="actions__hint">{mac ? '⌘ Enter' : 'Ctrl+Enter'}</span>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </form>
  );
}
