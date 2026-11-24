import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradeView } from '@trade-journal/shared';
import { TRADE_TITLE_ID, TradeForm } from './TradeForm.tsx';
import { fieldId } from './errorCopy.ts';

type FormProps = Parameters<typeof TradeForm>[0];

export type TradeDialogProps = Omit<
  FormProps,
  | 'onSaved'
  | 'onUnchanged'
  | 'onDeleted'
  | 'onGone'
  | 'onCancel'
  | 'onDirtyChange'
  | 'onSavingChange'
  | 'discard'
  | 'confirmDelete'
  | 'onAskDelete'
> & {
  open: boolean;
  /** Entry time to start with, a `datetime-local` value. Now when absent. */
  initialOpenedAt?: string;
  /**
   * Focused again when the dialog closes. Falls back to whatever had focus
   * when it opened (Safari doesn't focus a clicked button).
   */
  returnFocusTo?: HTMLElement | null;
  /** Called after the dialog has closed on a 201 or 200, with the toast text. */
  onSaved: (trade: TradeView, toast: string) => void;
  /** Called after the dialog has closed because the trade was deleted. */
  onDeleted?: () => void;
  /**
   * Called when the dialog closes after a save found the trade already
   * deleted, so the list behind it can reload.
   */
  onStale?: () => void;
  /** The trader closed the dialog, or it closed after a save. */
  onClose: () => void;
};

/**
 * The New trade dialog: a native `<dialog>` opened with `showModal()`, so the
 * page behind is inert and focus stays inside. The form is mounted only while
 * the dialog is open, so every open starts blank from the remembered defaults.
 *
 * The form owns its values, so it reports `dirty` and `saving` up. The dialog
 * owns closing: Esc, Cancel and × all end in `requestClose`.
 */
export function TradeDialog({
  open,
  onSaved,
  onDeleted,
  onStale,
  onClose,
  returnFocusTo,
  ...formProps
}: TradeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  // A save found the trade deleted, so closing the dialog reloads the list.
  const stale = useRef(false);
  const onCloseRef = useRef(onClose);
  const onStaleRef = useRef(onStale);
  const returnFocusRef = useRef(returnFocusTo);
  const modeRef = useRef(formProps.mode);
  useEffect(() => {
    onCloseRef.current = onClose;
    onStaleRef.current = onStale;
    returnFocusRef.current = returnFocusTo;
    modeRef.current = formProps.mode;
  });
  // True while the dialog should be showing, and set false just before we
  // close it ourselves, so a close we didn't ask for can be told apart.
  const shouldBeOpen = useRef(false);

  const setQuestion = useCallback((value: boolean) => {
    askingRef.current = value;
    setAsking(value);
  }, []);

  const setConfirm = useCallback((value: boolean) => {
    confirmingRef.current = value;
    setConfirming(value);
  }, []);

  const closeNow = useCallback(() => {
    if (stale.current) onStaleRef.current?.();
    onCloseRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (saving.current) return;
    if (confirmingRef.current) {
      // Esc on the delete question means "keep the trade".
      setConfirm(false);
      return;
    }
    if (askingRef.current) {
      // Esc on the question means "keep editing".
      setQuestion(false);
      return;
    }
    if (dirty.current) {
      setQuestion(true);
      return;
    }
    closeNow();
  }, [setQuestion, setConfirm, closeNow]);

  // Open and close the native dialog as `open` changes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const active = document.activeElement;
    opener.current =
      returnFocusRef.current ?? (active instanceof HTMLElement ? active : null);
    shouldBeOpen.current = true;
    if (!dialog.open) dialog.showModal();
    // Close trade starts on Exit, so the price is the first thing typed.
    const first = modeRef.current === 'close' ? 'exitPrice' : 'symbol';
    dialog.querySelector<HTMLElement>(`#${fieldId(first)}`)?.focus();
    return () => {
      // The form unmounts with `open`, so the next open starts clean.
      dirty.current = false;
      saving.current = false;
      stale.current = false;
      setQuestion(false);
      setConfirm(false);
      shouldBeOpen.current = false;
      if (dialog.open) dialog.close();
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
    };
    // Only `open`: the opener is read from a ref, so a new `returnFocusTo`
    // can never close and reopen a live dialog.
  }, [open, setQuestion, setConfirm]);

  // Esc is always ours: the browser would close the dialog and lose the form.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      requestClose();
    };
    // Esc is handled on keydown, before the browser starts a close request.
    // Chrome only lets `cancel` be prevented once per user activation, so a
    // second Esc on the discard question would otherwise close the dialog.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      requestClose();
    };
    // If the browser closes it anyway, reopen it: the form is still mounted
    // with the trader's values, and React still thinks it's open.
    const onCloseEvent = () => {
      if (shouldBeOpen.current && !dialog.open) dialog.showModal();
    };
    dialog.addEventListener('cancel', onCancelEvent);
    dialog.addEventListener('keydown', onKeyDown);
    dialog.addEventListener('close', onCloseEvent);
    return () => {
      dialog.removeEventListener('cancel', onCancelEvent);
      dialog.removeEventListener('keydown', onKeyDown);
      dialog.removeEventListener('close', onCloseEvent);
    };
  }, [requestClose]);

  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const onSavingChange = useCallback((value: boolean) => {
    saving.current = value;
  }, []);

  function finish(after: () => void) {
    // Close now, so the page is live again before the toast's text changes
    // and screen readers announce it.
    shouldBeOpen.current = false;
    dialogRef.current?.close();
    onClose();
    after();
  }

  function handleSaved(trade: TradeView, toast: string) {
    finish(() => onSaved(trade, toast));
  }

  function handleDeleted() {
    // The opener is about to go; the page decides where focus lands.
    opener.current = null;
    finish(() => onDeleted?.());
  }

  function handleUnchanged() {
    finish(() => {});
  }

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={TRADE_TITLE_ID}>
      {open && (
        <TradeForm
          {...formProps}
          onSaved={handleSaved}
          onUnchanged={handleUnchanged}
          onDeleted={handleDeleted}
          onGone={() => {
            stale.current = true;
          }}
          onCancel={requestClose}
          onDirtyChange={onDirtyChange}
          onSavingChange={onSavingChange}
          discard={
            asking
              ? {
                  onKeepEditing: () => setQuestion(false),
                  onDiscard: () => closeNow(),
                }
              : null
          }
          confirmDelete={
            confirming ? { onKeep: () => setConfirm(false) } : null
          }
          onAskDelete={() => {
            setQuestion(false);
            setConfirm(true);
          }}
        />
      )}
    </dialog>
  );
}
