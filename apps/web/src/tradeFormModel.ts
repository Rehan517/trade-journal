import {
  CreateTradeRequestSchema,
  NonNegativeDecimalStringSchema,
  PositiveDecimalStringSchema,
  compareDecimal,
  initialRisk,
  netPnl,
  parseDecimal,
  rMultiple,
  type CreateTradeRequestInput,
  type InstrumentType,
  type TradeMathInput,
  type TradeSide,
} from '@trade-journal/shared';
import {
  FIELD_ORDER,
  isFieldName,
  placeIssue,
  type FieldName,
} from './errorCopy.ts';
import { localToUtc } from './format.ts';

/** What's typed in the form: every value is the text of its input. */
export interface FormValues {
  instrumentType: InstrumentType;
  side: TradeSide;
  symbol: string;
  pointValue: string;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  fees: string;
  openedAt: string;
  closedAt: string;
  plannedStop: string;
  plannedTarget: string;
  notes: string;
}

export type FieldErrors = Partial<Record<FieldName, string>>;

const DECIMAL_FIELDS = [
  'pointValue',
  'quantity',
  'entryPrice',
  'exitPrice',
  'fees',
  'plannedStop',
  'plannedTarget',
] as const;

/**
 * The request body for the current values. Empty optional fields are left
 * out, a point value only goes with a future, and local times become UTC.
 */
export function buildBody(values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    instrumentType: values.instrumentType,
    side: values.side,
  };
  if (values.symbol !== '') body.symbol = values.symbol;
  for (const field of DECIMAL_FIELDS) {
    if (field === 'pointValue' && values.instrumentType !== 'future') continue;
    const text = values[field].trim();
    if (text !== '') body[field] = text;
  }
  if (values.openedAt !== '') body.openedAt = localToUtc(values.openedAt);
  if (values.closedAt !== '') body.closedAt = localToUtc(values.closedAt);
  if (values.notes !== '') body.notes = values.notes;
  return body;
}

export type CheckResult =
  | { ok: true; body: CreateTradeRequestInput }
  | { ok: false; errors: FieldErrors; other: string[] };

type Issue = { path: PropertyKey[]; message: string };

function collect(
  issues: readonly Issue[],
  values: FormValues,
  errors: FieldErrors,
  other: string[],
) {
  for (const issue of issues) {
    const name = String(issue.path[0] ?? '');
    if (!isFieldName(name)) {
      other.push(issue.message);
      continue;
    }
    const placed = placeIssue(name, issue.message, values);
    errors[placed.field] ??= placed.text;
  }
}

/**
 * Checks the values with the API's own schema. Zod skips the cross-field
 * rules when a required field is missing, so a second pass with stand-ins for
 * the missing ones brings those rules' problems up in the same save.
 */
export function checkForm(values: FormValues): CheckResult {
  const body = buildBody(values);
  const result = CreateTradeRequestSchema.safeParse(body);
  if (result.success) {
    return { ok: true, body: body as CreateTradeRequestInput };
  }
  const errors: FieldErrors = {};
  const other: string[] = [];
  collect(result.error.issues, values, errors, other);

  const missing = ['symbol', 'quantity', 'entryPrice', 'openedAt'].filter(
    (k) => !(k in body),
  );
  if (missing.length > 0) {
    const probe: Record<string, unknown> = { ...body };
    probe.symbol ??= 'X';
    probe.quantity ??= '1';
    probe.openedAt ??= '1970-01-01T00:00:00.000Z';
    if (probe.entryPrice === undefined) {
      // Stop and target are judged against the entry, so with none they wait.
      probe.entryPrice = '1';
      delete probe.plannedStop;
      delete probe.plannedTarget;
    }
    const second = CreateTradeRequestSchema.safeParse(probe);
    if (!second.success) collect(second.error.issues, values, errors, []);
  }
  return { ok: false, errors, other };
}

/** The first field with an error, in reading order. */
export function firstInvalid(errors: FieldErrors): FieldName | undefined {
  return FIELD_ORDER.find((f) => errors[f] !== undefined);
}

export interface Preview {
  netPnl?: string;
  initialRisk?: string;
  rMultiple?: string;
}

const isPositive = (s: string) =>
  PositiveDecimalStringSchema.safeParse(s).success;
const isWhole = (s: string) => /^\d+(\.0+)?$/.test(s);

function guarded<T>(fn: () => T): T | undefined {
  // The maths throws on input that skipped the field checks below. That
  // can't happen here, and a throw must never take the form down.
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Net P&L, planned risk and R for what's typed so far. The shared maths only
 * runs on values that pass their field checks, since it throws on the rest.
 */
export function computePreview(values: FormValues): Preview {
  const quantity = values.quantity.trim();
  const entryPrice = values.entryPrice.trim();
  const exitPrice = values.exitPrice.trim();
  const stop = values.plannedStop.trim();
  const fees = values.fees.trim();
  const pointValue = values.pointValue.trim();
  const future = values.instrumentType === 'future';

  if (!isPositive(quantity) || !isPositive(entryPrice)) return {};
  if (future && (!isPositive(pointValue) || !isWhole(quantity))) return {};

  const base: TradeMathInput = {
    instrumentType: values.instrumentType,
    side: values.side,
    quantity,
    entryPrice,
    ...(future ? { pointValue } : {}),
  };

  const feesOk =
    fees === '' || NonNegativeDecimalStringSchema.safeParse(fees).success;
  const net =
    isPositive(exitPrice) && feesOk
      ? guarded(() =>
          netPnl({ ...base, exitPrice, fees: fees === '' ? '0' : fees }),
        )
      : undefined;

  // A stop level with the entry gives zero risk, so no risk and no R.
  const stopOk =
    isPositive(stop) &&
    compareDecimal(parseDecimal(stop), parseDecimal(entryPrice)) !== 0;
  const risk = stopOk
    ? guarded(() => initialRisk({ ...base, plannedStop: stop }))
    : undefined;
  const r =
    net !== undefined && stopOk
      ? guarded(() =>
          rMultiple({
            ...base,
            exitPrice,
            fees: fees === '' ? '0' : fees,
            plannedStop: stop,
          }),
        )
      : undefined;

  return { netPnl: net, initialRisk: risk, rMultiple: r };
}
