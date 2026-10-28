import {
  cancelCreditNoteConfirm,
  readCancelCreditNoteRequired,
} from './cancel-credit-note.util';

/**
 * cod-auto-invoicing S5 — cancelling an order with a DIAN-accepted invoice
 * offers a clear confirmation to emit the TOTAL credit note and cancel.
 */
describe('readCancelCreditNoteRequired', () => {
  it('recognises the backend block and keeps the invoice number', () => {
    const httpError = {
      error: {
        error_code: 'ORD_CANCEL_CREDIT_NOTE_REQUIRED_001',
        message: 'x',
        details: { invoice_id: 9, invoice_number: 'FE-12' },
      },
    };
    expect(readCancelCreditNoteRequired(httpError)).toEqual({ invoiceNumber: 'FE-12' });
  });

  it('accepts an already wrapped error code', () => {
    expect(
      readCancelCreditNoteRequired({ errorCode: 'ORD_CANCEL_CREDIT_NOTE_REQUIRED_001' }),
    ).toEqual({ invoiceNumber: null });
  });

  it('ignores any other error', () => {
    expect(readCancelCreditNoteRequired({ error: { error_code: 'ORD_STATUS_001' } })).toBeNull();
    expect(readCancelCreditNoteRequired(new Error('boom'))).toBeNull();
  });
});

describe('cancelCreditNoteConfirm', () => {
  it('names the invoice and the total credit note before cancelling', () => {
    const data = cancelCreditNoteConfirm('FE-12');
    expect(data.message).toContain('FE-12');
    expect(data.message).toContain('nota crédito total');
    expect(data.confirmText).toBe('Emitir nota crédito y cancelar');
    expect(data.cancelText).toBe('Volver');
  });
});
