/**
 * Test-only stand-in for the page shell: the New trade dialog, open to start
 * with, plus the "Trade saved" toast and a button that opens it again. The
 * form tests render this instead of the bare form, since the form now lives
 * in the dialog and the toast in the shell.
 */
import { useState } from 'react';
import { Toast } from './FormParts.tsx';
import { TradeDialog, type TradeDialogProps } from './TradeDialog.tsx';

export function DialogHarness(
  props: Omit<TradeDialogProps, 'open' | 'onClose' | 'onSaved'> & {
    onSaved?: TradeDialogProps['onSaved'];
  },
) {
  const { onSaved, onDeleted, ...rest } = props;
  const [open, setOpen] = useState(true);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open trade dialog
      </button>
      <TradeDialog
        {...rest}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(trade, message) => {
          setToast((t) => ({ id: (t?.id ?? 0) + 1, message }));
          onSaved?.(trade, message);
        }}
        onDeleted={() => {
          setToast((t) => ({ id: (t?.id ?? 0) + 1, message: 'Trade deleted' }));
          onDeleted?.();
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
