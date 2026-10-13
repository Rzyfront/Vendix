import { signal } from '@angular/core';
import { OrderDetailsPageComponent } from './order-details-page.component';

describe('OrderDetailsPageComponent refund source mapping flow', () => {
  const apiDetails = {
    reason: 'refund_source_mapping_required', refund_id: 11, parent_invoice_id: 21,
    refund_item_candidates: [{ refund_item_id: 31, description: 'Camisa', source_candidates: [
      { source_invoice_item_id: 41, description: 'Camisa azul' },
      { source_invoice_item_id: 42, description: 'Camisa roja' },
    ] }],
    shipping_source_candidates: [],
  };

  function harness(): OrderDetailsPageComponent {
    const instance = Object.create(OrderDetailsPageComponent.prototype) as OrderDetailsPageComponent;
    const state = signal({ refundId: 11, invoiceId: 21, stage: 'creating' as const, error: null as string | null });
    Object.assign(instance, {
      refundNoteState: state,
      refundSourceChoices: signal<Record<number, number | null>>({}),
      refundShippingChoice: signal<number | null>(null),
      orderRefunds: signal([{ id: 11 }]),
      acceptedInvoice: signal({ id: 21 }),
      showInvoiceDetailModal: signal(false),
      loadInvoiceNotes: jasmine.createSpy('loadInvoiceNotes'),
      store: { dispatch: jasmine.createSpy('dispatch') },
      buildRefundNoteDto: jasmine.createSpy('buildRefundNoteDto').and.returnValue({ related_invoice_id: 21, refund_id: 11, reason: 'reembolso', note_concept_code: '1' }),
    });
    return instance;
  }

  it('turns a scoped mapping error into a mapping stage and ignores a foreign error', () => {
    const page = harness();
    page.onRefundNoteCreateFailed({ error: 'Seleccione el origen', errorCode: 'INVOICING_NOTE_SOURCE_001', details: apiDetails });
    expect(page.refundNoteState()?.stage).toBe('mapping');
    expect(page.refundNoteState()?.mapping?.refund_id).toBe(11);

    const foreign = harness();
    foreign.onRefundNoteCreateFailed({ error: 'Otro reembolso', errorCode: 'INVOICING_NOTE_SOURCE_001', details: { ...apiDetails, refund_id: 99 } });
    expect(foreign.refundNoteState()?.stage).toBe('creating');
    expect(foreign.refundNoteState()?.mapping).toBeUndefined();
    expect(foreign.refundNoteState()?.error).toBeNull();
  });

  it('does not let an unrelated issue failure clear an active mapping selection', () => {
    const page = harness();
    page.onRefundNoteCreateFailed({ error: 'Seleccione el origen', errorCode: 'INVOICING_NOTE_SOURCE_001', details: apiDetails });
    page.setRefundSourceChoice(31, 42);
    page.onRefundNoteIssueFailed('Fallo de otra nota');
    expect(page.refundNoteState()?.stage).toBe('mapping');
    expect(page.refundSourceChoices()[31]).toBe(42);
  });

  it('retries with explicit source IDs only and ignores a stale create success', () => {
    const page = harness();
    page.onRefundNoteCreateFailed({ error: 'Seleccione el origen', errorCode: 'INVOICING_NOTE_SOURCE_001', details: apiDetails });
    page.setRefundSourceChoice(31, 42);
    expect(page.refundMappingReady()).toBe(true);
    page.retryRefundNoteWithSources();
    const dispatch = (page as unknown as { store: { dispatch: jasmine.Spy } }).store.dispatch;
    const payload = dispatch.calls.mostRecent().args[0] as { dto: Record<string, unknown> };
    expect(payload.dto).toEqual({
      related_invoice_id: 21,
      refund_id: 11,
      reason: 'reembolso',
      note_concept_code: '1',
      refund_item_sources: [{ refund_item_id: 31, source_invoice_item_id: 42 }],
    });
    expect(payload.dto['items']).toBeUndefined();
    expect(payload.dto['total_amount']).toBeUndefined();

    page.onRefundNoteCreated({ id: 90, related_invoice_id: 99, refund_id: 11 } as never);
    expect(page.refundNoteState()?.stage).toBe('creating');
  });
});
