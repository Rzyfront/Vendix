import { normalizeNit } from '../../../common/utils/nit.util';

export interface BuyerEventReadinessInput {
  event_code: string;
  document_type: string | null | undefined;
  fiscal_document_type_code?: string | null;
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

/** Any known POS marker is ineligible; missing legacy metadata is not reclassified. */
export function receivedFiscalDocumentTypeCode(metadata: unknown): string | null {
  const record = metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : {};
  const email = record.email_reception != null && typeof record.email_reception === 'object' && !Array.isArray(record.email_reception)
    ? record.email_reception as Record<string, unknown> : {};
  const emailCode = typeof email.document_type_code === 'string' ? email.document_type_code : null;
  const code = typeof record.fiscal_document_type_code === 'string' ? record.fiscal_document_type_code : null;
  if (code === '20' || emailCode === '20') return '20';
  return emailCode ?? code;
}

/** Conservative local preflight only; it neither validates legal entitlement nor sends a DIAN event. */
export function evaluateBuyerEventReadiness(input: BuyerEventReadinessInput): BuyerEventReadiness {
  const blockers: string[] = [];
  const supportedEvent = ['030', '031', '032', '033'].includes(input.event_code);

  if (!supportedEvent) blockers.push('unsupported_event_code');
  if (input.document_type?.toLowerCase() !== 'invoice') blockers.push('invoice_document_required');
  if (input.fiscal_document_type_code === '20') blockers.push('document_pos_not_eligible');
  if (!input.document_key?.trim()) blockers.push('document_key_required');
  const issuer = normalizeNit(input.issuer_tax_id);
  const receiver = normalizeNit(input.receiver_tax_id);
  const tenant = normalizeNit(input.tenant_tax_id);
  if (!issuer.number) blockers.push('issuer_tax_id_required');
  if (!receiver.number) blockers.push('receiver_tax_id_required');
  if (receiver.dv_mismatch) blockers.push('invalid_receiver_dv');
  if (!tenant.number) blockers.push('tenant_tax_id_required');
  else if (tenant.dv_mismatch) blockers.push('invalid_tenant_dv');
  if (tenant.number && receiver.number && receiver.number !== tenant.number) blockers.push('receiver_tenant_tax_id_mismatch');
  if (!Number.isInteger(input.actor_id) || (input.actor_id ?? 0) <= 0) blockers.push('actor_required');
  if (input.validation_status !== 'valid') blockers.push('validation_incomplete');
  if (input.review_status !== 'reviewed') blockers.push('review_incomplete');

  switch (input.event_code) {
    case '030':
      if (input.has_prior_acknowledgement) blockers.push('acknowledgement_already_recorded');
      break;
    case '031':
      if (!input.claim_reason?.trim()) blockers.push('claim_reason_required');
      if (!input.has_prior_acknowledgement) blockers.push('prior_acknowledgement_required');
      if (!input.has_prior_goods_receipt) blockers.push('prior_goods_receipt_required');
      if (input.has_prior_acceptance) blockers.push('acceptance_already_recorded');
      break;
    case '032':
      // DIAN Anexo Técnico FEV v1.9 §8.5.1 (LGC09; pp. 598–599): 032 requires prior 030.
      // The caller's has_prior_acknowledgement contract must mean an accepted 030 only;
      // do not infer it from imported/internal timeline events. https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf
      if (!input.has_prior_acknowledgement) blockers.push('prior_acknowledgement_required');
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
