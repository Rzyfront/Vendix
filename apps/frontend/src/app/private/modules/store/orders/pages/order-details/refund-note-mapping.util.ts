import type { CreateCreditNoteDto, Invoice } from '../../../invoicing/interfaces/invoice.interface';

export interface RefundSourceCandidate {
  source_invoice_item_id: number;
  description: string;
}

export interface RefundItemSourceCandidate {
  refund_item_id: number;
  description: string;
  source_candidates: RefundSourceCandidate[];
}

export interface RefundNoteMappingChallenge {
  reason: 'refund_source_mapping_required';
  refund_id: number;
  parent_invoice_id: number;
  refund_item_candidates: RefundItemSourceCandidate[];
  shipping_source_candidates: RefundSourceCandidate[];
}

export interface RefundNoteSourceMapping {
  refund_item_sources: { refund_item_id: number; source_invoice_item_id: number }[];
  shipping_source_invoice_item_id?: number;
}

export interface RefundNoteState {
  refundId: number;
  invoiceId: number;
  stage: 'creating' | 'mapping' | 'ask' | 'issuing';
  mapping?: RefundNoteMappingChallenge;
  noteId?: number;
  noteNumber?: string | null;
  noteTotal?: number;
  error?: string | null;
}

export interface RefundNoteCreateFailure {
  error: string;
  errorCode?: string | null;
  details?: unknown;
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isText = (value: unknown): value is string => typeof value === 'string';

/** Distinguish a valid mapping error for another request from malformed details. */
export function isForeignRefundNoteMappingChallenge(
  value: unknown,
  refundId: number,
  parentInvoiceId: number,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const root = value as Record<string, unknown>;
  const details = root['details'] && typeof root['details'] === 'object'
    ? root['details'] as Record<string, unknown>
    : root;
  const otherId = (input: unknown): input is number =>
    typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
  return details['reason'] === 'refund_source_mapping_required' &&
    otherId(details['refund_id']) && otherId(details['parent_invoice_id']) &&
    (details['refund_id'] !== refundId || details['parent_invoice_id'] !== parentInvoiceId);
}

function parseCandidate(value: unknown): RefundSourceCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return isId(row['source_invoice_item_id']) && isText(row['description'])
    ? { source_invoice_item_id: row['source_invoice_item_id'], description: row['description'] }
    : null;
}

/** Accept only the scoped, structurally sound mapping challenge returned by the API. */
export function parseRefundNoteMappingChallenge(
  value: unknown,
  refundId: number,
  parentInvoiceId: number,
): RefundNoteMappingChallenge | null {
  if (!value || typeof value !== 'object' || !isId(refundId) || !isId(parentInvoiceId)) return null;
  const root = value as Record<string, unknown>;
  const details = root['details'] && typeof root['details'] === 'object'
    ? root['details'] as Record<string, unknown>
    : root;
  if (details['reason'] !== 'refund_source_mapping_required' ||
      details['refund_id'] !== refundId || details['parent_invoice_id'] !== parentInvoiceId ||
      !Array.isArray(details['refund_item_candidates']) ||
      !Array.isArray(details['shipping_source_candidates'])) return null;

  const seenRefunds = new Set<number>();
  const itemCandidates: RefundItemSourceCandidate[] = [];
  for (const entry of details['refund_item_candidates']) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (!isId(item['refund_item_id']) || seenRefunds.has(item['refund_item_id']) ||
        !isText(item['description']) || !Array.isArray(item['source_candidates'])) return null;
    seenRefunds.add(item['refund_item_id']);
    const sources: RefundSourceCandidate[] = [];
    const sourceIds = new Set<number>();
    for (const raw of item['source_candidates']) {
      const source = parseCandidate(raw);
      if (!source || sourceIds.has(source.source_invoice_item_id)) return null;
      sourceIds.add(source.source_invoice_item_id);
      sources.push(source);
    }
    if (sources.length < 2) return null;
    itemCandidates.push({ refund_item_id: item['refund_item_id'], description: item['description'], source_candidates: sources });
  }

  const shipping: RefundSourceCandidate[] = [];
  const shippingIds = new Set<number>();
  for (const raw of details['shipping_source_candidates']) {
    const source = parseCandidate(raw);
    if (!source || shippingIds.has(source.source_invoice_item_id)) return null;
    shippingIds.add(source.source_invoice_item_id);
    shipping.push(source);
  }
  if (itemCandidates.length === 0 && shipping.length < 2) return null;
  return {
    reason: 'refund_source_mapping_required', refund_id: refundId, parent_invoice_id: parentInvoiceId,
    refund_item_candidates: itemCandidates, shipping_source_candidates: shipping,
  };
}

/** Build only explicit choices; there is deliberately no default/first candidate. */
export function buildRefundNoteSourceMapping(
  challenge: RefundNoteMappingChallenge,
  itemChoices: Readonly<Record<number, number | null | undefined>>,
  shippingChoice?: number | null,
): RefundNoteSourceMapping | null {
  const usedSources = new Set<number>();
  const mappings: RefundNoteSourceMapping['refund_item_sources'] = [];
  for (const item of challenge.refund_item_candidates) {
    const selected = itemChoices[item.refund_item_id];
    if (!isId(selected) || !item.source_candidates.some((candidate) => candidate.source_invoice_item_id === selected) || usedSources.has(selected)) return null;
    usedSources.add(selected);
    mappings.push({ refund_item_id: item.refund_item_id, source_invoice_item_id: selected });
  }
  if (challenge.shipping_source_candidates.length > 1) {
    if (!isId(shippingChoice) || !challenge.shipping_source_candidates.some((candidate) => candidate.source_invoice_item_id === shippingChoice) || usedSources.has(shippingChoice)) return null;
    usedSources.add(shippingChoice);
    return { refund_item_sources: mappings, shipping_source_invoice_item_id: shippingChoice };
  }
  if (shippingChoice != null) return null;
  return { refund_item_sources: mappings };
}
/** Pure create-failure transition; unrelated/stale failures preserve identity. */
export function refundNoteCreateFailureState(
  current: RefundNoteState | null,
  failure: RefundNoteCreateFailure,
): RefundNoteState | null {
  if (!current || current.stage !== 'creating') return current;
  if (failure.errorCode === 'INVOICING_NOTE_SOURCE_001' &&
      isForeignRefundNoteMappingChallenge(failure.details, current.refundId, current.invoiceId)) return current;
  const challenge = failure.errorCode === 'INVOICING_NOTE_SOURCE_001'
    ? parseRefundNoteMappingChallenge(failure.details, current.refundId, current.invoiceId)
    : null;
  return challenge
    ? { ...current, stage: 'mapping', mapping: challenge, error: failure.error }
    : { ...current, stage: 'ask', error: failure.error };
}

/** Pure create-success transition; only a result linked to this refund/source is accepted. */
export function refundNoteCreatedState(
  current: RefundNoteState | null,
  invoice: Pick<Invoice, 'id' | 'invoice_number' | 'total_amount' | 'related_invoice_id' | 'refund_id'>,
): RefundNoteState | null {
  if (!current || current.stage !== 'creating' ||
      invoice.related_invoice_id !== current.invoiceId || invoice.refund_id !== current.refundId) return current;
  return {
    ...current,
    stage: 'ask',
    noteId: invoice.id,
    noteNumber: invoice.invoice_number,
    noteTotal: Number(invoice.total_amount),
  };
}

/** Only an issue failure belonging to the active issue transition may change it. */
export function refundNoteIssueFailureState(
  current: RefundNoteState | null,
  error: string,
): RefundNoteState | null {
  return current?.stage === 'issuing' ? { ...current, stage: 'ask', error } : current;
}

export function matchesRefundNoteIssueResult(current: RefundNoteState | null, invoiceId: number): boolean {
  return current?.stage === 'issuing' && current.noteId === invoiceId;
}

/** Build a retry request from the commercial base DTO plus explicit source IDs only. */
export function buildRefundNoteRetryDto(
  current: RefundNoteState | null,
  itemChoices: Readonly<Record<number, number | null | undefined>>,
  shippingChoice: number | null | undefined,
  baseDto: CreateCreditNoteDto,
): CreateCreditNoteDto | null {
  if (!current || current.stage !== 'mapping' || !current.mapping ||
      baseDto.related_invoice_id !== current.invoiceId || baseDto.refund_id !== current.refundId) return null;
  const mapping = buildRefundNoteSourceMapping(current.mapping, itemChoices, shippingChoice);
  return mapping ? { ...baseDto, ...mapping } : null;
}
