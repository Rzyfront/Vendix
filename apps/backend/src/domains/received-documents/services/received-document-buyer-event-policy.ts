export interface BuyerEventReadinessInput {
  event_code: string;
  document_type: string | null | undefined;
  issuer_tax_id: string | null | undefined;
  receiver_tax_id: string | null | undefined;
  document_key: string | null | undefined;
  tenant_tax_id: string | null | undefined;
  validation_status: string | null | undefined;
  review_status: string | null | undefined;
  actor_id: number | null | undefined;
  has_prior_acknowledgement: boolean;
  has_prior_acceptance: boolean;
  has_goods_receipt_evidence: boolean;
  claim_reason?: string | null;
  has_prior_goods_receipt: boolean;
  has_prior_claim: boolean;
}

export interface BuyerEventReadiness {
  ready: boolean;
  blockers: readonly string[];
}

function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? '').replace(/[^\d]/g, '');
}

/** Conservative local preflight only; it neither validates legal entitlement nor sends a DIAN event. */
export function evaluateBuyerEventReadiness(input: BuyerEventReadinessInput): BuyerEventReadiness {
  const blockers: string[] = [];
  const supportedEvent = ['030', '031', '032', '033'].includes(input.event_code);

  if (!supportedEvent) blockers.push('unsupported_event_code');
  if (input.document_type?.toLowerCase() !== 'invoice') blockers.push('invoice_document_required');
  if (!input.document_key?.trim()) blockers.push('document_key_required');
  if (!normalizeTaxId(input.issuer_tax_id)) blockers.push('issuer_tax_id_required');
  if (!normalizeTaxId(input.receiver_tax_id)) blockers.push('receiver_tax_id_required');
  const receiver = normalizeTaxId(input.receiver_tax_id);
  const tenant = normalizeTaxId(input.tenant_tax_id);
  if (!tenant) blockers.push('tenant_tax_id_required');
  else if (receiver && receiver !== tenant) blockers.push('receiver_tenant_tax_id_mismatch');
  if (!Number.isInteger(input.actor_id) || (input.actor_id ?? 0) <= 0) blockers.push('actor_required');
  if (input.validation_status !== 'valid') blockers.push('validation_incomplete');
  if (input.review_status !== 'reviewed') blockers.push('review_incomplete');

  switch (input.event_code) {
    case '030':
      if (input.has_prior_acknowledgement) blockers.push('acknowledgement_already_recorded');
      break;
    case '031':
      if (!input.claim_reason?.trim()) blockers.push('claim_reason_required');
      if (input.has_prior_acceptance) blockers.push('acceptance_already_recorded');
      break;
    case '032':
      if (!input.has_goods_receipt_evidence) blockers.push('goods_receipt_evidence_required');
      if (input.has_prior_goods_receipt) blockers.push('goods_receipt_already_recorded');
      break;
    case '033':
      if (!input.has_prior_acknowledgement) blockers.push('prior_acknowledgement_required');
      if (!input.has_prior_goods_receipt) blockers.push('prior_goods_receipt_required');
      if (input.has_prior_claim) blockers.push('claim_already_recorded');
      if (input.has_prior_acceptance) blockers.push('acceptance_already_recorded');
      break;
  }

  return { ready: blockers.length === 0, blockers };
}
