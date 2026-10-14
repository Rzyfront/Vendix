import {
  buildRefundNoteRetryDto,
  matchesRefundNoteIssueResult,
  refundNoteCreateFailureState,
  refundNoteCreatedState,
  refundNoteIssueFailureState,
  type RefundNoteState,
} from './refund-note-mapping.util';

describe('refund note flow used by order details', () => {
  const apiDetails = {
    reason: 'refund_source_mapping_required', refund_id: 11, parent_invoice_id: 21,
    refund_item_candidates: [{ refund_item_id: 31, description: 'Camisa', source_candidates: [
      { source_invoice_item_id: 41, description: 'Camisa azul' },
      { source_invoice_item_id: 42, description: 'Camisa roja' },
    ] }],
    shipping_source_candidates: [],
  };
  const creating: RefundNoteState = { refundId: 11, invoiceId: 21, stage: 'creating', error: null };

  it('moves a scoped source error to mapping and builds an ID-only retry DTO', () => {
    const mapping = refundNoteCreateFailureState(creating, {
      error: 'Seleccione el origen', errorCode: 'INVOICING_NOTE_SOURCE_001', details: apiDetails,
    });
    expect(mapping?.stage).toBe('mapping');
    const dto = buildRefundNoteRetryDto(mapping, { 31: 42 }, null, {
      related_invoice_id: 21, refund_id: 11, reason: 'reembolso', note_concept_code: '1',
    });
    expect(dto).toEqual({
      related_invoice_id: 21, refund_id: 11, reason: 'reembolso', note_concept_code: '1',
      refund_item_sources: [{ refund_item_id: 31, source_invoice_item_id: 42 }],
    });
    expect(dto?.items).toBeUndefined();
    expect(dto && 'total_amount' in dto).toBeFalse();
  });

  it('preserves current state for a foreign failure and ignores stale create success', () => {
    const foreign = refundNoteCreateFailureState(creating, {
      error: 'Otro reembolso', errorCode: 'INVOICING_NOTE_SOURCE_001',
      details: { ...apiDetails, refund_id: 99 },
    });
    expect(foreign).toBe(creating);
    const stale = refundNoteCreatedState(creating, {
      id: 90, related_invoice_id: 99, refund_id: 11, invoice_number: 'NC-90', total_amount: 80,
    });
    expect(stale).toBe(creating);
  });

  it('retains mapping on unrelated issue failure and accepts only the matching issue result', () => {
    const mapping = refundNoteCreateFailureState(creating, {
      error: 'Seleccione el origen', errorCode: 'INVOICING_NOTE_SOURCE_001', details: apiDetails,
    })!;
    expect(refundNoteIssueFailureState(mapping, 'Fallo de otra nota')).toBe(mapping);

    const issuing: RefundNoteState = { refundId: 11, invoiceId: 21, stage: 'issuing', noteId: 51 };
    expect(matchesRefundNoteIssueResult(issuing, 52)).toBeFalse();
    expect(matchesRefundNoteIssueResult(issuing, 51)).toBeTrue();
    expect(refundNoteIssueFailureState(issuing, 'Falló la emisión')).toEqual({
      refundId: 11, invoiceId: 21, stage: 'ask', noteId: 51, error: 'Falló la emisión',
    });
  });

  it('accepts only matching create success and preserves server total snapshot', () => {
    const created = refundNoteCreatedState(creating, {
      id: 50, related_invoice_id: 21, refund_id: 11, invoice_number: 'NC-50', total_amount: 123.45,
    });
    expect(created).toEqual({
      ...creating, stage: 'ask', noteId: 50, noteNumber: 'NC-50', noteTotal: 123.45,
    });
  });
});
