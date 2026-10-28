import type { BulkInvoicePreviewRow } from './orders-bulk-invoice.interface';
import {
  buildInvoiceQueue,
  paymentLabel,
  queueRequiresCredit,
} from './orders-bulk-invoice.util';

describe('orders-bulk-invoice.util — unpaid order to Consumidor final', () => {
  const row = (over: Partial<BulkInvoicePreviewRow> = {}): BulkInvoicePreviewRow => ({
    id: 1,
    order_number: 'ORD-1',
    grand_total: '100000.00',
    payment: 'to_credit',
    blocked_code: null,
    holder: {
      rail: 'nominative',
      source: 'customer',
      name: 'Juan',
      document_type: 'CC',
      document_number: '123',
      verification_digit: null,
    },
    holder_issue: null,
    cf_overridable: false,
    will_emit: true,
    skip_reason: null,
    ...over,
  } as BulkInvoicePreviewRow);

  const unpaidCf = () =>
    row({ holder_issue: { code: 'missing_name' } as never, cf_overridable: true, will_emit: false });

  it('an unpaid row opted into Consumidor final does not ask for the credit step', () => {
    expect(queueRequiresCredit(buildInvoiceQueue([unpaidCf()], true))).toBe(false);
  });

  it('an unpaid row emitted to its own customer still needs the credit step', () => {
    expect(queueRequiresCredit(buildInvoiceQueue([row()], false))).toBe(true);
  });

  it('labels the unpaid CF row as cash «Acuerdo mutuo» only when opted in', () => {
    expect(paymentLabel(unpaidCf(), true)).toBe('Contado · Acuerdo mutuo');
    expect(paymentLabel(unpaidCf(), false)).toBe('Pasa a crédito');
    expect(paymentLabel(row())).toBe('Pasa a crédito');
  });
});
