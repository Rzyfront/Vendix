import { buildRefundNoteSourceMapping, parseRefundNoteMappingChallenge } from './refund-note-mapping.util';

const challenge = {
  reason: 'refund_source_mapping_required', refund_id: 11, parent_invoice_id: 21,
  refund_item_candidates: [{ refund_item_id: 31, description: 'Camisa', source_candidates: [
    { source_invoice_item_id: 41, description: 'Camisa azul' },
    { source_invoice_item_id: 42, description: 'Camisa roja' },
  ] }],
  shipping_source_candidates: [],
};

describe('refund note source mapping', () => {
  it('parses a scoped challenge and builds explicit choices', () => {
    const parsed = parseRefundNoteMappingChallenge(challenge, 11, 21)!;
    expect(parsed).not.toBeNull();
    expect(buildRefundNoteSourceMapping(parsed, { 31: 42 })).toEqual({
      refund_item_sources: [{ refund_item_id: 31, source_invoice_item_id: 42 }],
    });
  });

  it('rejects incomplete, foreign, malformed, and duplicate mappings', () => {
    const parsed = parseRefundNoteMappingChallenge(challenge, 11, 21)!;
    expect(parseRefundNoteMappingChallenge(challenge, 12, 21)).toBeNull();
    expect(parseRefundNoteMappingChallenge({ ...challenge, parent_invoice_id: 99 }, 11, 21)).toBeNull();
    expect(parseRefundNoteMappingChallenge({ ...challenge, refund_item_candidates: [{ ...challenge.refund_item_candidates[0], source_candidates: [...challenge.refund_item_candidates[0].source_candidates, challenge.refund_item_candidates[0].source_candidates[0]] }] }, 11, 21)).toBeNull();
    expect(buildRefundNoteSourceMapping(parsed, {})).toBeNull();
    expect(buildRefundNoteSourceMapping(parsed, { 31: 999 })).toBeNull();
  });

  it('requires shipping choice when ambiguous and prevents reusing a source', () => {
    const parsed = parseRefundNoteMappingChallenge({
      ...challenge,
      shipping_source_candidates: [
        { source_invoice_item_id: 41, description: 'Envío' },
        { source_invoice_item_id: 43, description: 'Flete' },
      ],
    }, 11, 21)!;
    expect(buildRefundNoteSourceMapping(parsed, { 31: 41 })).toBeNull();
    expect(buildRefundNoteSourceMapping(parsed, { 31: 42 }, 43)).toEqual({
      refund_item_sources: [{ refund_item_id: 31, source_invoice_item_id: 42 }],
      shipping_source_invoice_item_id: 43,
    });
  });
});
