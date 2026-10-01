import { evaluateBuyerEventReadiness, BuyerEventReadinessInput } from './received-document-buyer-event-policy';

const validInput = (event_code: string): BuyerEventReadinessInput => ({
  event_code,
  document_type: 'invoice',
  issuer_tax_id: '900123456',
  receiver_tax_id: '900123456-8',
  document_key: 'CUFE-123',
  tenant_tax_id: '900123456',
  validation_status: 'valid',
  review_status: 'reviewed',
  actor_id: 42,
  has_prior_acknowledgement: false,
  has_prior_acceptance: false,
  has_goods_receipt_evidence: true,
  claim_reason: undefined,
  has_prior_goods_receipt: false,
  has_prior_claim: false,
});

describe('evaluateBuyerEventReadiness', () => {
  it.each(['030', '031', '032', '033'])('permits eligible event %s', (event_code) => {
    const input = validInput(event_code);
    if (event_code === '031') input.claim_reason = 'Invoice amount differs';
    if (event_code === '033') {
      input.has_prior_acknowledgement = true;
      input.has_prior_goods_receipt = true;
    }
    expect(evaluateBuyerEventReadiness(input)).toEqual({ ready: true, blockers: [] });
  });

  it('blocks missing evidence, identity, actor, and incomplete statuses', () => {
    const input = validInput('032');
    input.has_goods_receipt_evidence = false;
    input.document_key = ' ';
    input.issuer_tax_id = null;
    input.receiver_tax_id = null;
    input.actor_id = 0;
    input.validation_status = 'pending';
    input.review_status = 'pending';
    const result = evaluateBuyerEventReadiness(input);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'goods_receipt_evidence_required', 'document_key_required', 'issuer_tax_id_required',
      'receiver_tax_id_required', 'actor_required', 'validation_incomplete', 'review_incomplete',
    ]));
  });

  it('requires the internal reviewed status rather than an unproduced approved status', () => {
    const input = validInput('030');
    input.review_status = 'approved';
    expect(evaluateBuyerEventReadiness(input).blockers).toContain('review_incomplete');
  });

  it.each(['034', '999'])('always blocks unsupported event %s', (event_code) => {
    expect(evaluateBuyerEventReadiness(validInput(event_code)).blockers).toContain('unsupported_event_code');
  });

  it('blocks acknowledgement, claim reason, duplicate receipt and acceptance conditions', () => {
    const ack = validInput('030');
    ack.has_prior_acknowledgement = true;
    expect(evaluateBuyerEventReadiness(ack).blockers).toContain('acknowledgement_already_recorded');

    const claim = validInput('031');
    expect(evaluateBuyerEventReadiness(claim).blockers).toContain('claim_reason_required');
    claim.claim_reason = 'dispute';
    claim.has_prior_acceptance = true;
    expect(evaluateBuyerEventReadiness(claim).blockers).toContain('acceptance_already_recorded');

    const receipt = validInput('032');
    receipt.has_prior_goods_receipt = true;
    expect(evaluateBuyerEventReadiness(receipt).blockers).toContain('goods_receipt_already_recorded');
  });

  it('blocks event 033 after a claim and without both prior events', () => {
    const input = validInput('033');
    input.has_prior_acknowledgement = true;
    input.has_prior_goods_receipt = true;
    input.has_prior_claim = true;
    expect(evaluateBuyerEventReadiness(input).blockers).toContain('claim_already_recorded');
  });

  it('requires exact normalized receiver/tenant NIT equality', () => {
    const input = validInput('030');
    input.receiver_tax_id = '900123457';
    expect(evaluateBuyerEventReadiness(input).blockers).toContain('receiver_tenant_tax_id_mismatch');
  });

  it('accepts the same NIT number with or without a valid DV', () => {
    const input = validInput('030');
    input.receiver_tax_id = '900123456-8';
    input.tenant_tax_id = '900123456';
    expect(evaluateBuyerEventReadiness(input)).toEqual({ ready: true, blockers: [] });
  });

  it.each([
    ['receiver_tax_id', '900123456-7', 'invalid_receiver_dv'],
    ['tenant_tax_id', '900123456-7', 'invalid_tenant_dv'],
  ] as const)('rejects an explicit invalid DV on %s', (field, value, blocker) => {
    const input = validInput('030');
    input[field] = value;
    expect(evaluateBuyerEventReadiness(input).blockers).toContain(blocker);
  });

  it('does not mutate its input', () => {
    const input = validInput('031');
    input.claim_reason = 'Difference';
    const before = { ...input };
    evaluateBuyerEventReadiness(input);
    expect(input).toEqual(before);
  });
});
