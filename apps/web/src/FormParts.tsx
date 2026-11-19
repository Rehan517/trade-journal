import {
  useEffect,
  useRef,
  type ChangeEvent,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { fieldId, type FieldName } from './errorCopy.ts';
import { formatAmount, formatMoney, formatR, type Tone } from './format.ts';
import type { Preview } from './tradeFormModel.ts';

const errorId = (field: FieldName) => `tf-${field}-error`;

/** Clicking anywhere in a cell focuses its input. */
function focusControl(e: MouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, label')) return;
  e.currentTarget
    .querySelector<HTMLElement>('input:not([type="radio"]), textarea')
    ?.focus();
}

export function TextCell({
  field,
  label,
  value,
  onChange,
  onBlur,
  error,
  className = '',
  decimal = false,
  type = 'text',
  placeholder,
  prefix,
  suffix,
  maxLength,
  symbol = false,
}: {
  field: FieldName;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  className?: string;
  /** A number typed as text, so the phone shows the decimal keypad. */
  decimal?: boolean;
  type?: 'text' | 'datetime-local';
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  maxLength?: number;
  symbol?: boolean;
}) {
  return (
    <div
      className={`cell ${className}`}
      data-invalid={error ? 'true' : undefined}
      onClick={focusControl}
    >
      <label className="cell__label" htmlFor={fieldId(field)}>
        {label}
      </label>
      <div className="cell__control">
        {prefix && (
          <span className="cell__affix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={fieldId(field)}
          className={`cell__input${type === 'datetime-local' ? ' cell__input--time' : ''}`}
          type={type}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          onBlur={onBlur}
          inputMode={decimal ? 'decimal' : undefined}
          enterKeyHint="next"
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize={symbol ? 'characters' : undefined}
          spellCheck={symbol ? false : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId(field) : undefined}
        />
        {suffix && (
          <span className="cell__affix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p className="cell__error" id={errorId(field)}>
          {error}
        </p>
      )}
    </div>
  );
}

export function NotesCell({
  value,
  onChange,
  onBlur,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
}) {
  return (
    <div
      className="cell cell--notes"
      data-invalid={error ? 'true' : undefined}
      onClick={focusControl}
    >
      <label className="cell__label" htmlFor={fieldId('notes')}>
        Notes
      </label>
      <div className="cell__control">
        <textarea
          id={fieldId('notes')}
          className="cell__input cell__input--notes"
          rows={2}
          value={value}
          maxLength={5000}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId('notes') : undefined}
        />
      </div>
      {error && (
        <p className="cell__error" id={errorId('notes')}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A two-segment radio group in one cell. Arrow keys move between segments. */
export function SegmentedCell<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  name: string;
  label: string;
  value: T;
  options: readonly { value: T; text: string; glyph?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`cell cell--segmented ${className}`}>
      <span className="cell__label" id={`${name}-label`}>
        {label}
      </span>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={`${name}-label`}
      >
        {options.map((option) => (
          <label className="segmented__option" key={option.value}>
            <input
              className="segmented__input"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="segmented__face">
              {option.glyph && (
                <span aria-hidden="true" className="segmented__glyph">
                  {option.glyph}
                </span>
              )}
              {option.glyph ? ' ' : ''}
              {option.text}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Figure({
  label,
  text,
  tone,
  className,
}: {
  label: string;
  text: string | undefined;
  tone: Tone | 'muted';
  className: string;
}) {
  return (
    <div className={`strip__item ${className}`}>
      <span className="strip__label">{label}</span>{' '}
      <span
        className="strip__value"
        data-tone={text === undefined ? 'muted' : tone}
      >
        {text ?? '–'}
      </span>
    </div>
  );
}

/** Net P&L, risk and R under the ticket's double rule. */
export function ResultStrip({ preview }: { preview: Preview }) {
  const net = preview.netPnl ? formatMoney(preview.netPnl) : undefined;
  const r = preview.rMultiple ? formatR(preview.rMultiple) : undefined;
  return (
    <div
      className="strip"
      role="group"
      aria-label="Result"
      aria-live="polite"
      aria-atomic="true"
    >
      <Figure
        label="Net P&L"
        text={net?.text}
        tone={net?.tone ?? 'muted'}
        className="strip__item--net"
      />
      <Figure
        label="Risk"
        text={
          preview.initialRisk ? formatAmount(preview.initialRisk) : undefined
        }
        tone="muted"
        className="strip__item--risk"
      />
      <Figure
        label="R multiple"
        text={r?.text}
        tone={r?.tone ?? 'muted'}
        className="strip__item--r"
      />
    </div>
  );
}

const TOAST_MS = 4000;

/**
 * A small ticket naming what just happened. Goes after 4s, and stays while
 * the pointer or focus is on it. The live region is always in the page so
 * screen readers announce the text when it arrives.
 */
export function Toast({
  toast,
  onDismiss,
}: {
  toast: { id: number; message: string } | null;
  onDismiss: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  const start = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss.current(), TOAST_MS);
  };
  const hold = () => clearTimeout(timer.current);

  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return;
    timer.current = setTimeout(() => dismiss.current(), TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [id]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div
          className="toast"
          key={toast.id}
          onMouseEnter={hold}
          onMouseLeave={start}
          onFocus={hold}
          onBlur={start}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}
