/**
 * The form's wording for validation problems. The schema's messages are
 * written for developers; the form shows the design system's copy instead
 * (spec: trades #7, "Error copy"). A message with no mapping is shown as is,
 * so nothing is ever hidden.
 */

export type FieldName =
  | 'instrumentType'
  | 'side'
  | 'symbol'
  | 'pointValue'
  | 'quantity'
  | 'entryPrice'
  | 'exitPrice'
  | 'fees'
  | 'openedAt'
  | 'closedAt'
  | 'plannedStop'
  | 'plannedTarget'
  | 'notes';

/** Reading order, which is also DOM order and Tab order at every width. */
export const FIELD_ORDER: readonly FieldName[] = [
  'instrumentType',
  'side',
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
];

/** DOM id of a field's input. */
export const fieldId = (field: FieldName) => `tf-${field}`;

export function isFieldName(name: string): name is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(name);
}

export const TOGETHER_MESSAGE =
  'exitPrice and closedAt must be provided together';

const PRICE = 'Enter a price, like 5012.25.';

/** Schema message from the trades spec's validation table, to form copy. */
export const ERROR_COPY: Readonly<Record<string, string>> = {
  [TOGETHER_MESSAGE]: 'Add an exit time, or clear the exit price.',
  'closedAt must not be before openedAt':
    "Exit time can't be before entry time.",
  'pointValue is required for futures': 'Enter dollars per point, like 5.',
  // The cell is hidden for stocks, so this can't happen. Shown as is if it does.
  'pointValue is only allowed for futures':
    'pointValue is only allowed for futures',
  'quantity must be a whole number for futures':
    'Futures quantity must be a whole number.',
  'plannedStop must be below entryPrice for a long':
    'Stop must be below entry for a long trade.',
  'plannedStop must be above entryPrice for a short':
    'Stop must be above entry for a short trade.',
  'plannedTarget must be above entryPrice for a long':
    'Target must be above entry for a long trade.',
  'plannedTarget must be below entryPrice for a short':
    'Target must be below entry for a short trade.',
};

export const EXIT_PRICE_MISSING_COPY =
  'Add an exit price, or clear the exit time.';

/**
 * Copy for field-level problems (a missing value, or a bad format). The
 * schema's own wording for these is zod's, so they're matched by field.
 */
const FIELD_COPY: Partial<Record<FieldName, string>> = {
  quantity: 'Enter a quantity above 0, like 2.',
  entryPrice: PRICE,
  exitPrice: PRICE,
  plannedStop: PRICE,
  plannedTarget: PRICE,
  pointValue: 'Enter dollars per point, like 5.',
  fees: 'Enter fees as an amount, like 1.24, or leave blank.',
  openedAt: 'Enter the entry time.',
};

const SYMBOL_MISSING = 'Enter a symbol, like MES or AAPL.';
const SYMBOL_TOO_LONG = 'Symbols are 12 characters or fewer.';
const NOTES_TOO_LONG = 'Notes are 5000 characters or fewer.';

const isTooBig = (message: string) => message.startsWith('Too big');

/** Messages from the shared decimal schemas (packages/shared decimal.ts). */
const DECIMAL_MESSAGES: ReadonlySet<string> = new Set([
  'Must be a decimal string such as "187.50"',
  'Must be greater than zero',
]);

/**
 * A field-level problem: a missing value or a bad format, worded by zod's
 * built-in messages ("Invalid input…", "Too small…", "Too big…") or the
 * shared decimal schemas. Only these get the field's own copy. Anything
 * else is a message the form doesn't know, and is shown as is.
 */
function isFieldLevel(message: string): boolean {
  return (
    DECIMAL_MESSAGES.has(message) ||
    message.startsWith('Invalid') ||
    message.startsWith('Too small') ||
    isTooBig(message)
  );
}

/** The form's copy for one issue on one field. */
export function explainIssue(field: FieldName, message: string): string {
  const mapped = ERROR_COPY[message];
  if (mapped !== undefined) return mapped;
  if (!isFieldLevel(message)) return message;
  if (field === 'symbol')
    return isTooBig(message) ? SYMBOL_TOO_LONG : SYMBOL_MISSING;
  if (field === 'notes' && isTooBig(message)) return NOTES_TOO_LONG;
  return FIELD_COPY[field] ?? message;
}

/**
 * Where an issue shows and what it says. The schema reports "exit price and
 * exit time together" on the exit time, but when the time is the one that's
 * filled in, the cell to fix is the exit price.
 */
export function placeIssue(
  field: FieldName,
  message: string,
  values: { exitPrice: string; closedAt: string },
): { field: FieldName; text: string } {
  if (message === TOGETHER_MESSAGE && values.exitPrice.trim() === '') {
    return { field: 'exitPrice', text: EXIT_PRICE_MISSING_COPY };
  }
  return { field, text: explainIssue(field, message) };
}
