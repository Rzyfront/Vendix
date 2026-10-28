import type { BulkInvoicePreviewRow } from './orders-bulk-invoice.interface';
import {
  buildInvoiceQueue,
  paymentLabel,
  queueRequiresCredit,
  unpaidFinalConsumerCount,
} from './orders-bulk-invoice.util';
import { signal } from '@angular/core';
import { OrdersBulkInvoiceModalComponent } from './orders-bulk-invoice-modal.component';

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

  it('counts only the unpaid rows that can go out as Consumidor final', () => {
    const paidCf = row({ ...unpaidCf(), payment: 'paid' });
    expect(unpaidFinalConsumerCount([unpaidCf(), unpaidCf(), paidCf, row()])).toBe(2);
  });

  describe('opting into Consumidor final', () => {
    const proto = OrdersBulkInvoiceModalComponent.prototype;
    const build = (rows: BulkInvoicePreviewRow[], answer: boolean) => ({
      rows: () => rows,
      allowFinalConsumer: signal(false),
      dialogService: { confirm: jasmine.createSpy('confirm').and.resolveTo(answer) },
    });

    it('asks before emitting unpaid orders cash; «Volver» keeps it off', async () => {
      const self = build([unpaidCf(), unpaidCf()], false);
      await proto.onToggleFinalConsumer.call(self as never, true);
      const data = self.dialogService.confirm.calls.mostRecent().args[0];
      expect(data.title).toBe('Órdenes sin pagar');
      expect(data.message).toContain('2 órdenes no están pagadas');
      expect(data.message).toContain('de contado, como ya pagada');
      expect(self.allowFinalConsumer()).toBe(false);
    });

    it('turns it on after «Sí, emitir a Consumidor final»', async () => {
      const self = build([unpaidCf()], true);
      await proto.onToggleFinalConsumer.call(self as never, true);
      expect(self.allowFinalConsumer()).toBe(true);
    });

    it('paid rows and unchecking never ask', async () => {
      const self = build([row({ ...unpaidCf(), payment: 'paid' })], false);
      await proto.onToggleFinalConsumer.call(self as never, true);
      expect(self.allowFinalConsumer()).toBe(true);
      await proto.onToggleFinalConsumer.call(self as never, false);
      expect(self.allowFinalConsumer()).toBe(false);
      expect(self.dialogService.confirm).not.toHaveBeenCalled();
    });
  });
});
