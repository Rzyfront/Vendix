import type { ConfirmData } from '../../../../../shared/components/dialog/dialog.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';

export const CANCEL_CREDIT_NOTE_REQUIRED_CODE = 'ORD_CANCEL_CREDIT_NOTE_REQUIRED_001';

/**
 * cod-auto-invoicing S5 — reads the backend 409 that blocks cancelling an
 * order with a DIAN-accepted e-invoice. Returns the invoice number when the
 * error is that block, or `null` for any other error.
 */
export function readCancelCreditNoteRequired(
  error: unknown,
): { invoiceNumber: string | null } | null {
  const wrapped = error as { errorCode?: string | null } | null;
  const parsed = parseApiError(error);
  const code = wrapped?.errorCode ?? parsed.errorCode;
  if (code !== CANCEL_CREDIT_NOTE_REQUIRED_CODE) return null;
  const details = (parsed.details ?? {}) as { invoice_number?: unknown };
  return {
    invoiceNumber:
      typeof details.invoice_number === 'string' && details.invoice_number.trim()
        ? details.invoice_number
        : null,
  };
}

/** Confirmation before cancelling with an automatic TOTAL credit note. */
export function cancelCreditNoteConfirm(invoiceNumber: string | null): ConfirmData {
  const invoice = invoiceNumber ? `la factura electrónica ${invoiceNumber}` : 'una factura electrónica';
  return {
    title: 'Cancelar orden facturada',
    message:
      `Esta orden tiene ${invoice} aceptada por la DIAN.<br><br>` +
      'Para cancelarla se emitirá una <strong>nota crédito total</strong> por el valor de la factura ' +
      'y luego se cancelará la orden. La nota crédito no se puede deshacer.<br><br>' +
      '¿Deseas continuar?',
    confirmText: 'Emitir nota crédito y cancelar',
    cancelText: 'Volver',
    confirmVariant: 'danger',
  };
}
